"use client";

import { useEffect, useRef, useState, isValidElement, cloneElement } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";

/**
 * Dialog untuk form tambah/ubah.
 *
 * Memakai elemen <dialog> bawaan browser supaya tombol Esc, penguncian fokus,
 * dan nonaktifnya latar belakang berjalan sendiri.
 *
 * Dialognya dipasang lewat portal ke <body>, BUKAN di tempat tombolnya berada.
 * Ini penting: pemicu modal sering berada di dalam sel tabel, dan sel seperti
 * <td class="num"> mewariskan `text-align: right` serta `display: flex` ke
 * seluruh isi dialog -- formnya jadi rata kanan dan berantakan. Elemen di top
 * layer memang lepas dari tata letak induknya, tapi tetap mewarisi gaya teks.
 *
 * Isi `children` boleh berupa form dengan server action: setelah tersimpan,
 * halaman melakukan redirect sehingga dialog ikut tertutup dengan sendirinya.
 * Kalau aksinya gagal dan kembali dengan ?error=, pakai `defaultOpen` supaya
 * dialog terbuka lagi.
 */
export default function Modal({
  trigger,
  title,
  description,
  children,
  defaultOpen = false,
  width = 440,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // Tanpa ini fokus mendarat di tombol tutup -- tombol pertama di DOM --
      // sehingga yang paling menonjol saat dialog terbuka justru tombol batal.
      const pertama = el.querySelector<HTMLElement>(
        ".nerva-dialog-body input:not([type='hidden']):not([disabled]), " +
          ".nerva-dialog-body select, .nerva-dialog-body textarea",
      );
      pertama?.focus();
    }
    if (!open && el.open) el.close();
  }, [open, mounted]);

  // Pemicu dipaksa type="button" supaya tidak ikut mengirim form di sekitarnya.
  const triggerEl = isValidElement(trigger)
    ? cloneElement(trigger as React.ReactElement<Record<string, unknown>>, {
        type: (trigger as React.ReactElement<{ type?: string }>).props.type ?? "button",
        onClick: () => setOpen(true),
      })
    : trigger;

  const dialog = (
    <dialog
      ref={ref}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onClick={(e) => {
        // Klik di area backdrop (di luar kotak) menutup dialog.
        if (e.target === ref.current) setOpen(false);
      }}
      className="nerva-dialog"
      style={{ maxWidth: width }}
    >
      <div className="nerva-dialog-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h2>
          {description && (
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen(false)}
          aria-label="Tutup"
          style={{ minHeight: 34, padding: "4px 7px" }}
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="nerva-dialog-body">{children}</div>
    </dialog>
  );

  return (
    <>
      {triggerEl}
      {mounted ? createPortal(dialog, document.body) : null}
    </>
  );
}

/** Baris tombol di bagian bawah form dalam dialog. */
export function ModalActions({ children }: { children: React.ReactNode }) {
  return <div className="nerva-dialog-actions">{children}</div>;
}
