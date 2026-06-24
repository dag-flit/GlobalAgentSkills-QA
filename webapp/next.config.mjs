/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Drivers de BD y motor del kit (.mjs con imports propios) corren en Node, fuera del bundle.
  serverExternalPackages: ["pg", "mysql2", "mssql", "ssh2", "playwright"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
