import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ada package-lock.json lain di D:\project; tunjuk root secara eksplisit
  // supaya Next tidak salah menebak dan menyertakan berkas di luar proyek.
  outputFileTracingRoot: __dirname,
  /* config options here */
};

export default nextConfig;
