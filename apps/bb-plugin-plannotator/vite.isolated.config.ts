export default {
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { dedupe: ["react", "react-dom"] },
  build: {
    target: "es2022", minify: "esbuild", emptyOutDir: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
    lib: { entry: "isolated-entry.tsx", formats: ["es"], fileName: () => "isolated-app.generated.txt" },
    outDir: ".",
  },
};
