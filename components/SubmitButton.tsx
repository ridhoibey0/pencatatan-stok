"use client";

import { useFormStatus } from "react-dom";

/**
 * Tombol kirim yang menonaktifkan diri selama aksi berjalan.
 *
 * Tanpa ini, form tanpa umpan balik gampang ditekan dua kali — dan di aplikasi
 * pencatatan stok, kiriman ganda berarti stok berkurang dua kali.
 */
export default function SubmitButton({
  children,
  pendingLabel,
  className = "btn btn-primary",
  style,
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      style={style}
      aria-busy={pending}
    >
      {pending && (
        <span
          aria-hidden
          style={{
            width: 14,
            height: 14,
            border: "2px solid currentColor",
            borderTopColor: "transparent",
            borderRadius: "50%",
            display: "inline-block",
            animation: "nerva-spin 0.6s linear infinite",
          }}
        />
      )}
      {pending ? (pendingLabel ?? "Menyimpan…") : children}
      <style jsx global>{`
        @keyframes nerva-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </button>
  );
}
