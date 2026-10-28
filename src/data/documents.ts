/**
 * documents.ts — Akses data template dokumen (kontrak, kuitansi, surat).
 *
 * Tabel `document_templates` menyimpan versi: setiap penyimpanan membuat versi
 * baru sehingga dokumen yang sudah dicetak tidak berubah karena perubahan
 * template di kemudian hari (dokumen pada masa lalu tetap dapat direproduksi).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TABLES } from '@/lib/supabase';
import { unwrap, supabase } from '@/data/client';
import { toAppError } from '@/lib/errors';

export const DOCUMENT_KINDS = ['CONTRACT', 'RECEIPT', 'REMINDER', 'STATEMENT'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  CONTRACT: 'Kontrak Kredit',
  RECEIPT: 'Kuitansi Pembayaran',
  REMINDER: 'Surat Pengingat',
  STATEMENT: 'Surat Keterangan Piutang',
};

export interface DocumentTemplateRow {
  id: string;
  organization_id: string;
  kind: DocumentKind;
  name: string;
  body: string;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Daftar template dokumen organisasi (versi terbaru per nama). */
export async function fetchDocumentTemplates(organizationId: string): Promise<DocumentTemplateRow[]> {
  const result = await supabase()
    .from(TABLES.documentTemplates)
    .select('*')
    .eq('organization_id', organizationId)
    .order('kind')
    .order('name')
    .order('version', { ascending: false });
  return unwrap<DocumentTemplateRow[]>(result, 'memuat template dokumen');
}

export function useDocumentTemplates(organizationId: string | null) {
  return useQuery({
    queryKey: ['document-templates', organizationId],
    queryFn: () => fetchDocumentTemplates(organizationId!),
    enabled: Boolean(organizationId),
  });
}

export interface SaveDocumentTemplateInput {
  readonly id?: string | null;
  readonly kind: DocumentKind;
  readonly name: string;
  readonly body: string;
  readonly isActive: boolean;
  readonly version?: number;
}

/**
 * Menyimpan template dokumen.
 * Bila `id` diberikan, baris tersebut diperbarui; bila tidak, versi baru dibuat
 * dengan nomor versi tertinggi + 1 untuk nama yang sama.
 */
export function useSaveDocumentTemplate(organizationId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveDocumentTemplateInput) => {
      if (!organizationId) throw toAppError({ message: 'Organisasi aktif tidak ditemukan.' });
      const name = input.name.trim();
      if (name.length < 2) throw toAppError({ message: 'Nama template minimal 2 karakter.' });
      if (input.body.trim().length < 10) throw toAppError({ message: 'Isi template minimal 10 karakter.' });

      if (input.id) {
        const result = await supabase()
          .from(TABLES.documentTemplates)
          .update({
            name,
            body: input.body,
            is_active: input.isActive,
            updated_by: (await supabase().auth.getUser()).data.user?.id ?? null,
          })
          .eq('id', input.id)
          .select('*')
          .single();
        return unwrap<DocumentTemplateRow>(result as never, 'memperbarui template dokumen');
      }

      const existing = await supabase()
        .from(TABLES.documentTemplates)
        .select('version')
        .eq('organization_id', organizationId)
        .eq('kind', input.kind)
        .eq('name', name)
        .order('version', { ascending: false })
        .limit(1);

      const rows = unwrap<{ version: number }[]>(existing, 'memeriksa versi template');
      const nextVersion = (rows[0]?.version ?? 0) + 1;

      const result = await supabase()
        .from(TABLES.documentTemplates)
        .insert({
          organization_id: organizationId,
          kind: input.kind,
          name,
          body: input.body,
          version: nextVersion,
          is_active: input.isActive,
          created_by: (await supabase().auth.getUser()).data.user?.id ?? null,
        })
        .select('*')
        .single();

      return unwrap<DocumentTemplateRow>(result as never, 'menyimpan template dokumen');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['document-templates'] });
    },
  });
}

/** Mengaktifkan atau menonaktifkan sebuah template. */
export function useToggleDocumentTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; isActive: boolean }) => {
      const result = await supabase()
        .from(TABLES.documentTemplates)
        .update({ is_active: params.isActive })
        .eq('id', params.id)
        .select('*')
        .single();
      return unwrap<DocumentTemplateRow>(result as never, 'mengubah status template dokumen');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['document-templates'] });
    },
  });
}
