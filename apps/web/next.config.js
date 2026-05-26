/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@lockedin/shared"],
  outputFileTracingRoot: require("path").join(__dirname, "../.."),
};

module.exports = nextConfig;
