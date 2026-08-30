import { NextRequest, NextResponse } from "next/server";
import { ingestDocument } from "@/lib/ingest";
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/ingest/parse";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB size limit` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await ingestDocument({
      filename: file.name,
      fileType: file.type,
      buffer,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("[upload]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Upload failed unexpectedly",
      },
      { status: 500 }
    );
  }
}