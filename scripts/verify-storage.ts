import { uploadPrivateArtifact, removePrivateArtifact } from "../src/services/storage-service.js";

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const id = "00000000-0000-0000-0000-000000000000";
const stored = await uploadPrivateArtifact({ eventId: id, teamId: id, roundId: id, submissionId: id, originalName: "storage-health.png", mimeType: "image/png", body: pixel });
await removePrivateArtifact(stored.bucket, stored.path);
console.log(`Storage verified: private upload and cleanup succeeded in bucket ${stored.bucket}.`);
