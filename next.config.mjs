/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  serverExternalPackages: ['esbuild','pg'],
  async rewrites() {
    const origin = process.env.SWARM_API_URL?.replace(/\/$/, '');
    return { beforeFiles: origin ? [{ source: '/api/:path*', destination: `${origin}/api/:path*` }] : [] };
  },
};
export default nextConfig;
