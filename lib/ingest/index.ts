import { extractTextFromBuffer } from "@/lib/ingest/parse";
import { chunkText, type Chunk } from "@/lib/ingest/chunk";
import { embedChunks } from "@/lib/ingest/embed";
import { createServerSupabase } from "@/lib/supabase/server";
import { traceEvent } from "@/lib/observability/langfuse";

/**
 * Full ingestion pipeline: parse -> chunk -> embed -> store.
 * Updates the `documents` row through processing -> ready / failed.
 */
export async function ingestDocument(params: {
  filename: string;
  fileType: string;
  buffer: Buffer;
}): Promise<{ documentId: string; chunkCount: number }> {
  const supabase = createServerSupabase();
  const trace = await traceEvent({
    name: "ingest",
    input: { filename: params.filename, fileType: params.fileType },
  });

  try {
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({
        filename: params.filename,
        file_type: params.fileType,
        status: "processing",
      })
      .select()
      .single();

    if (docError || !doc) {
      throw new Error(`Failed to create document record: ${docError?.message}`);
    }

    try {
      const extracted = await extractTextFromBuffer(
        params.buffer,
        params.fileType
      );

      const chunks: Chunk[] = chunkText(extracted.text);

      const embeddings = await embedChunks(chunks.map((c) => c.content));

      const rows = chunks.map((chunk, i) => ({
        document_id: doc.id,
        content: chunk.content,
        embedding: embeddings[i],
        page_number: chunk.pageNumber,
        chunk_index: chunk.chunkIndex,
        token_count: chunk.tokenCount,
      }));

      // Insert in batches to stay within payload limits.
      for (let i = 0; i < rows.length; i += 100) {
        const { error: insertError } = await supabase
          .from("chunks")
          .insert(rows.slice(i, i + 100));
        if (insertError) {
          throw new Error(`Failed to insert chunks: ${insertError.message}`);
        }
      }

      const { error: updateError } = await supabase
        .from("documents")
        .update({
          status: "ready",
          page_count: extracted.pageCount ?? chunks[chunks.length - 1]?.pageNumber ?? null,
        })
        .eq("id", doc.id);
      if (updateError) {
        throw new Error(`Failed to mark document ready: ${updateError.message}`);
      }

      await trace.update({ output: { chunkCount: rows.length } });
      return { documentId: doc.id, chunkCount: rows.length };
    } catch (innerError) {
      await supabase
        .from("documents")
        .update({ status: "failed" })
        .eq("id", doc.id);
      throw innerError;
    }
  } catch (error) {
    await trace.error(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await trace.flush();
  }
}