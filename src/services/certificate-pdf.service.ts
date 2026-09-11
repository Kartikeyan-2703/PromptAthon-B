import PDFDocument from "pdfkit";

const WIDTH = 1492;
const HEIGHT = 1055;
const GREEN = "#063d27";
const GOLD = "#b88719";
const INK = "#071d14";

const centered = (doc: PDFKit.PDFDocument, text: string, y: number, options: PDFKit.Mixins.TextOptions = {}) =>
  doc.text(text, 0, y, { width: WIDTH, align: "center", ...options });

function circuit(doc: PDFKit.PDFDocument, x: number, y: number, flip = false) {
  doc.save().strokeColor("#c9d8ce").lineWidth(1.5).opacity(0.75);
  for (let index = 0; index < 5; index += 1) {
    const yy = y + index * 30;
    const direction = flip ? -1 : 1;
    doc.moveTo(x, yy).lineTo(x + direction * (35 + index * 10), yy).lineTo(x + direction * (60 + index * 10), yy + 25).stroke();
    doc.circle(x, yy, 4).stroke();
  }
  doc.restore();
}

export async function buildParticipationCertificate(input: { memberName: string; certificateCode: string }) {
  const doc = new PDFDocument({ size: [WIDTH, HEIGHT], margin: 0, info: { Title: `PROMPTHON 2026 Participation Certificate - ${input.memberName}`, Author: "Easwari Engineering College" } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });

  doc.rect(0, 0, WIDTH, HEIGHT).fill("#fffefb");
  doc.lineWidth(2).strokeColor(GOLD).rect(16, 16, WIDTH - 32, HEIGHT - 32).stroke();
  doc.lineWidth(5).strokeColor(GREEN).rect(24, 24, WIDTH - 48, HEIGHT - 48).stroke();
  doc.lineWidth(1).strokeColor(GOLD).rect(31, 31, WIDTH - 62, HEIGHT - 62).stroke();

  doc.fillColor(GREEN).polygon([24, 24], [155, 24], [92, 92], [24, 92]).fill();
  doc.fillColor(GOLD).polygon([115, 24], [145, 24], [79, 94], [67, 82]).fill();
  doc.fillColor(GREEN).polygon([WIDTH - 24, 24], [WIDTH - 155, 24], [WIDTH - 92, 92], [WIDTH - 24, 92]).fill();
  doc.fillColor(GOLD).polygon([WIDTH - 115, 24], [WIDTH - 145, 24], [WIDTH - 79, 94], [WIDTH - 67, 82]).fill();
  doc.fillColor(GREEN).polygon([24, HEIGHT - 24], [170, HEIGHT - 24], [100, HEIGHT - 100], [24, HEIGHT - 100]).fill();
  doc.fillColor(GREEN).polygon([WIDTH - 24, HEIGHT - 24], [WIDTH - 170, HEIGHT - 24], [WIDTH - 100, HEIGHT - 100], [WIDTH - 24, HEIGHT - 100]).fill();
  circuit(doc, 52, 100); circuit(doc, WIDTH - 52, 100, true); circuit(doc, 72, 440); circuit(doc, WIDTH - 72, 440, true);

  // Use explicit single-line boxes here. PDFKit otherwise wraps the long CSBS
  // headings and lets the wrapped line collide with the following heading.
  const departmentX = 225;
  const departmentWidth = 410;
  const departmentLine = (text: string, y: number, size: number) =>
    doc.font("Helvetica-Bold").fontSize(size).text(text, departmentX, y, {
      width: departmentWidth,
      height: size + 8,
      align: "center",
      lineBreak: false,
    });
  doc.fillColor(INK);
  departmentLine("DEPARTMENT OF", 54, 24);
  departmentLine("COMPUTER SCIENCE", 84, 29);
  departmentLine("AND", 121, 17);
  departmentLine("BUSINESS SYSTEMS", 145, 29);
  doc.font("Helvetica").fontSize(8).text("EMPOWERING TECHNOLOGY FOR A BETTER TOMORROW", departmentX, 188, { width: departmentWidth, align: "center", characterSpacing: 2.4, lineBreak: false });
  doc.strokeColor("#83958b").moveTo(645, 50).lineTo(645, 220).stroke().moveTo(845, 50).lineTo(845, 220).stroke();
  doc.fillColor(GOLD).circle(745, 107, 55).strokeColor(GREEN).lineWidth(4).stroke();
  doc.fillColor(GREEN).font("Times-Bold").fontSize(24).text("EEC", 705, 92, { width: 80, align: "center" });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text("AUTONOMOUS", 687, 170, { width: 116, align: "center" });
  doc.fillColor("#651015").font("Times-Bold").fontSize(54).text("EASWARI", 870, 54, { width: 410, align: "center" });
  doc.fontSize(32).text("ENGINEERING COLLEGE", 870, 110, { width: 410, align: "center" });
  doc.font("Helvetica-Bold").fontSize(14).text("An AUTONOMOUS Institution", 870, 154, { width: 410, align: "center" });
  doc.rect(875, 185, 400, 30).fill("#651015");
  doc.fillColor("#ffffff").fontSize(16).text("RAMAPURAM, CHENNAI", 875, 192, { width: 400, align: "center" });

  doc.fillColor(GREEN).font("Times-Bold").fontSize(64);
  centered(doc, "CERTIFICATE OF PARTICIPATION", 270);
  doc.strokeColor(GOLD).lineWidth(2).moveTo(390, 368).lineTo(545, 368).stroke().moveTo(947, 368).lineTo(1102, 368).stroke();
  doc.fillColor(INK).font("Helvetica").fontSize(17); centered(doc, "THIS IS TO CERTIFY THAT", 357, { characterSpacing: 7 });
  doc.fillColor(GREEN).font("Times-Bold").fontSize(input.memberName.length > 34 ? 44 : 54); centered(doc, input.memberName.toUpperCase(), 420);
  doc.strokeColor(GOLD).moveTo(375, 485).lineTo(1117, 485).stroke();
  doc.fillColor("#151515").font("Times-Roman").fontSize(25); centered(doc, "for successfully participating in", 510);
  doc.fillColor(GREEN).font("Helvetica-Bold").fontSize(57); centered(doc, "PROMPTHON", 556);
  doc.fillColor("#ffffff").font("Helvetica-BoldOblique").fontSize(22);
  doc.fillColor(GREEN).polygon([492, 625], [1000, 625], [980, 671], [512, 671]).fill();
  doc.fillColor(GOLD).polygon([480, 625], [505, 625], [485, 671], [462, 671]).fill().polygon([1012, 625], [1035, 625], [1010, 671], [987, 671]).fill();
  doc.fillColor("#ffffff"); centered(doc, "A PROMPT ENGINEERING CHALLENGE", 636);
  doc.fillColor("#171717").font("Times-Roman").fontSize(21); centered(doc, "organized by the Department of Computer Science and Business Systems,", 700); centered(doc, "Easwari Engineering College, held on 12 September 2026.", 731); centered(doc, "We appreciate your enthusiasm, creativity and active participation.", 778);
  doc.strokeColor(GOLD).moveTo(605, 820).lineTo(725, 820).stroke().circle(746, 820, 3).fill(GOLD).moveTo(767, 820).lineTo(887, 820).stroke();

  doc.fillColor("#24372d").font("Times-Roman").fontSize(13).text(`Certificate ID: ${input.certificateCode}`, 255, 944, { width: 330 });
  doc.text("Date: 12 September 2026", 590, 944, { width: 260, align: "center" });
  doc.text("Department of Computer Science and Business Systems", 850, 944, { width: 390, align: "right" });
  doc.font("Helvetica").fontSize(8); centered(doc, "EASWARI ENGINEERING COLLEGE  /  EDUCATE  /  INNOVATE  /  EXCEL", 995, { characterSpacing: 5 });
  doc.end();
  return completed;
}
