// Build the embeddable editor bundle into dist/.
//
// Mirrors Fontra's own webpack.config.cjs, but with a single view: our
// src/embed.html, which is editor.html @ the pinned commit with the entry
// script swapped for src/embed-entry.js. Static assets (css/, images/,
// tabler-icons/, lang/, data/, fonts/) are copied from the vendored
// @fontra/core package; the test harness is copied to dist/harness/.
const HtmlBundlerPlugin = require("html-bundler-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const path = require("path");

const coreAssets = path.join(
  path.dirname(require.resolve("@fontra/core/webpack.config.cjs")),
  "assets"
);

module.exports = (_env, argv) => {
  return import("@fontra/core/webpack-base.js").then(({ makeConfig }) => {
    return makeConfig({
      home: __dirname,
      destination: path.resolve(__dirname, "dist"),
      production: argv.mode === "production",
      custom: {
        plugins: [
          new HtmlBundlerPlugin({
            entry: {
              editor: path.resolve(__dirname, "src/embed.html"),
            },
            js: {
              filename: "js/[name].[contenthash:8].js",
              chunkFilename: "js/[name].chunk.js",
            },
            css: {
              filename: "css/[name].[contenthash:8].css",
            },
          }),
          new CopyPlugin({
            patterns: [
              { context: coreAssets, from: "**/*" },
              {
                from: "harness/**",
                to: "[path][name][ext]",
                filter: (filepath) => !filepath.endsWith("verify.mjs"),
              },
            ],
          }),
        ],
      },
    });
  });
};
