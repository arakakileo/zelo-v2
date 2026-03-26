import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // standalone output is required for Docker production builds.
  // Disabled locally on Windows (symlink creation requires Developer Mode).
  ...(process.env.NEXT_STANDALONE === 'true' ? { output: 'standalone' } : {}),
  transpilePackages: ['@zelo/contracts'],
};

export default nextConfig;
