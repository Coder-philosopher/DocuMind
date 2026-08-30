import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export const ALLOWED_FILE_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown"];

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export interface ExtractedDocument {
  text: string;
  pageCount: number | null;
  fileType: string;
}

/**
 * Extract raw text from an uploaded file buffer based on its MIME type.
 * @throws if the type is not allowed or parsing fails.
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  fileType: string
): Promise<ExtractedDocument> {
  if (!ALLOWED_FILE_TYPES.includes(fileType)) {
    throw new Error(`Unsupported file type: ${fileType}`);
  }

  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB size limit`
    );
  }

  switch (fileType) {
    case "application/pdf": {
      const parsed = await pdfParse(buffer);
      return {
        text: parsed.text,
        pageCount: parsed.numpages ?? null,
        fileType,
      };
    }
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value,
        pageCount: null,
        fileType,
      };
    }
    case "text/plain":
    case "text/markdown": {
      return {
        text: buffer.toString("utf-8"),
        pageCount: null,
        fileType,
      };
    }
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}