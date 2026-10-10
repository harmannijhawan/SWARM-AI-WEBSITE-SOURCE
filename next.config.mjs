/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.SWARM_BUILD_DIR || '.next',
  images: { unoptimized: true },
  serverExternalPackages: ['esbuild','pg'],
  async rewrites() {
    const origin = process.env.SWARM_API_URL?.replace(/\/$/, '');
    return { beforeFiles: origin ? [{ source: '/api/:path*', destination: `${origin}/api/:path*` }] : [] };
  },
};
export default nextConfig;
