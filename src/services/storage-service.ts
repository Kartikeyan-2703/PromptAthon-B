import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { serviceUnavailable } from "../lib/errors.js";

const configuration = () => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw serviceUnavailable("STORAGE_UNAVAILABLE", "Secure submission storage is not configured.");
  return { base: env.SUPABASE_URL.replace(/\/$/, ""), key: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.SUPABASE_STORAGE_BUCKET };
};
const headers = (key: string) => ({ apikey: key, authorization: `Bearer ${key}` });
const objectPath = (bucket: string, path: string) => `${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;

async function ensureBucket() {
  const { base, key, bucket } = configuration();
  const check = await fetch(`${base}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers: headers(key) });
  if (check.ok) return;
  if (check.status !== 404) throw serviceUnavailable("STORAGE_UNAVAILABLE", "Submission storage could not be reached.");
  const created = await fetch(`${base}/storage/v1/bucket`, { method: "POST", headers: { ...headers(key), "content-type": "application/json" }, body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: env.STORAGE_MAX_FILE_BYTES, allowed_mime_types: ["image/png", "image/jpeg", "image/webp"] }) });
  if (!created.ok && created.status !== 409) throw serviceUnavailable("STORAGE_UNAVAILABLE", "The private submission bucket could not be initialized.");
}

async function ensurePrivateBucket(bucket: string, allowedMimeTypes: string[], maxBytes: number) {
  const { base, key } = configuration();
  const check = await fetch(`${base}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers: headers(key) });
  if (check.ok) return;
  // Supabase Storage has returned both 400 and 404 for a missing bucket across API versions.
  if (check.status !== 400 && check.status !== 404) throw serviceUnavailable("STORAGE_UNAVAILABLE", "Private storage could not be reached.");
  const created = await fetch(`${base}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers(key), "content-type": "application/json" },
    body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: maxBytes, allowed_mime_types: allowedMimeTypes }),
  });
  if (!created.ok && created.status !== 409) throw serviceUnavailable("STORAGE_UNAVAILABLE", "The private storage bucket could not be initialized.");
}

export async function uploadPrivateArtifact(input: { eventId: string; teamId: string; roundId: string; submissionId: string; originalName: string; mimeType: string; body: Buffer }) {
  await ensureBucket();
  const { base, key, bucket } = configuration();
  const safeName = input.originalName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "artifact";
  const path = `${input.eventId}/${input.teamId}/${input.roundId}/${input.submissionId}/${randomUUID()}-${safeName}`;
  const response = await fetch(`${base}/storage/v1/object/${objectPath(bucket, path)}`, { method: "POST", headers: { ...headers(key), "content-type": input.mimeType, "x-upsert": "false" }, body: input.body });
  if (!response.ok) throw serviceUnavailable("STORAGE_UPLOAD_FAILED", "The artifact could not be stored securely.");
  return { bucket, path };
}

export async function downloadPrivateArtifact(bucket: string, path: string) {
  const { base, key } = configuration();
  const response = await fetch(`${base}/storage/v1/object/${objectPath(bucket, path)}`, { headers: headers(key) });
  if (!response.ok) throw serviceUnavailable("STORAGE_DOWNLOAD_FAILED", "The artifact could not be retrieved.");
  return Buffer.from(await response.arrayBuffer());
}

export async function removePrivateArtifact(bucket: string, path: string) {
  const { base, key } = configuration();
  await fetch(`${base}/storage/v1/object/${encodeURIComponent(bucket)}`, { method: "DELETE", headers: { ...headers(key), "content-type": "application/json" }, body: JSON.stringify({ prefixes: [path] }) });
}

export async function uploadPrivateCertificate(path: string, body: Buffer) {
  const bucket = env.SUPABASE_CERTIFICATE_BUCKET;
  await ensurePrivateBucket(bucket, ["application/pdf"], 12 * 1024 * 1024);
  const { base, key } = configuration();
  const response = await fetch(`${base}/storage/v1/object/${objectPath(bucket, path)}`, {
    method: "POST",
    headers: { ...headers(key), "content-type": "application/pdf", "x-upsert": "true" },
    body,
  });
  if (!response.ok) throw serviceUnavailable("CERTIFICATE_STORAGE_FAILED", "The certificate could not be stored securely.");
  return { bucket, path };
}
