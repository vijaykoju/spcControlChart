// Ambient shim so the TypeScript compiler can resolve `.less` imports.
// webpack's less-loader handles these at build time; this only satisfies `tsc`.
declare module "*.less";
