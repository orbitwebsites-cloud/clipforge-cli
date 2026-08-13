import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Vercel packages route handlers itself. The standalone bundle is only
  // required by our Docker runtime and conflicts with Vercel's build tracer.
  output: process.env.VERCEL ? undefined : 'standalone',
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
};

export default nextConfig;
