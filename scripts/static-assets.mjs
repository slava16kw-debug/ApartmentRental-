import { readFile, readdir } from 'node:fs/promises';

const contentTypes = {
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// Embed the same public files that the Vercel build copies into its output.
export async function loadPublicAssets() {
  const assets = {};
  async function visit(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      const path = prefix + entry.name;
      if (entry.isDirectory()) await visit(file, path + '/');
      else {
        const extension = entry.name.slice(entry.name.lastIndexOf('.'));
        assets[path] = { contentType: contentTypes[extension] || 'application/octet-stream', body: (await readFile(file)).toString('base64') };
      }
    }
  }
  await visit(new URL('../public/', import.meta.url), '/');
  return assets;
}
