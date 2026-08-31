import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { Gate } from "@/components/gate";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "DocuMind — Enterprise Agentic RAG",
  description:
    "Upload enterprise documents and ask grounded, citation-backed questions with hybrid retrieval and agentic reasoning.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Gate>{children}</Gate>
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}