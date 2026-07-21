import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Vite serves the pdf.js worker as a fingerprinted asset URL; point pdfjs-dist
// at it once, at module load, so getDocument() below can spin up the worker.
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

const TEXT_MIME_PREFIX = "text/";
const TEXT_MIME_TYPES = new Set(["application/json"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".css",
  ".html",
  ".xml",
  ".yaml",
  ".yml",
  ".sh",
  ".sql",
  ".log",
]);

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

function isTextLike(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (mime.startsWith(TEXT_MIME_PREFIX)) return true;
  if (TEXT_MIME_TYPES.has(mime)) return true;
  return TEXT_EXTENSIONS.has(getExtension(file.name));
}

function isPdf(file: File): boolean {
  return file.type.toLowerCase() === "application/pdf" || getExtension(file.name) === ".pdf";
}

async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item): item is TextItem => "str" in item)
      .map((item) => item.str)
      .join(" ");
    pageTexts.push(pageText);
  }
  return pageTexts.join("\n\n");
}

/**
 * Extract plain text from a browser `File`. Supports text-like files (plain
 * text, markdown, CSV, JSON, common code files) and PDFs. Throws a clear
 * error for anything else (e.g. images, binary formats) so callers can
 * surface it to the user.
 */
export async function extractFileText(file: File): Promise<string> {
  if (isPdf(file)) {
    return extractPdfText(file);
  }
  if (isTextLike(file)) {
    return await file.text();
  }
  throw new Error(
    `Can't extract text from "${file.name}" (${file.type || "unknown type"}). Only text-based files (.txt, .md, .csv, .json, code files) and PDFs are supported.`,
  );
}
