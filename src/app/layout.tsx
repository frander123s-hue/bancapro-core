import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BancaPro Core | Plataforma Multi-Tenant Lotto Activo",
  description:
    "Sistema transaccional ACID de alta concurrencia para bancas de lotería de animalitos con Supabase RLS y soporte térmico ESC/POS.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
