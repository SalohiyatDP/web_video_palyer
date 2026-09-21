import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Tiny JSON-file backed store for video metadata.
 * All writes are serialised through a promise queue and written atomically
 * (temp file + rename) so a crash cannot leave a half-written catalogue.
 */
export function createStore(filePath) {
  let cache = null;
  let cachedStamp = null;
  let queue = Promise.resolve();

  /** Fayl o‘zgarganini aniqlash uchun «muhr» (o‘zgartirilgan vaqt + hajm). */
  async function fileStamp() {
    try {
      const stat = await fs.stat(filePath);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return null;
    }
  }

  /**
   * Katalogni o‘qiydi. Fayl tashqaridan o‘zgargan bo‘lsa (masalan, qo‘lda
   * tahrirlangan yoki boshqa jarayon yozgan) — kesh yangilanadi.
   */
  async function load() {
    const stamp = await fileStamp();
    if (cache && stamp === cachedStamp) return cache;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      cache = Array.isArray(parsed?.videos) ? parsed.videos : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      cache = [];
    }
    cachedStamp = stamp;
    return cache;
  }

  async function persist() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    const body = JSON.stringify({ videos: cache }, null, 2);
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, filePath);
    cachedStamp = await fileStamp();
  }

  /** Runs `fn` exclusively, guaranteeing serialised mutations. */
  function mutate(fn) {
    const run = queue.then(async () => {
      await load();
      const result = await fn(cache);
      await persist();
      return result;
    });
    // Keep the chain alive even if a caller rejects.
    queue = run.catch(() => {});
    return run;
  }

  return {
    async list() {
      const videos = await load();
      return [...videos].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    async get(id) {
      const videos = await load();
      return videos.find((video) => video.id === id) ?? null;
    },

    add(video) {
      return mutate((videos) => {
        videos.push(video);
        return video;
      });
    },

    update(id, patch) {
      return mutate((videos) => {
        const index = videos.findIndex((video) => video.id === id);
        if (index === -1) return null;
        videos[index] = { ...videos[index], ...patch, id };
        return videos[index];
      });
    },

    remove(id) {
      return mutate((videos) => {
        const index = videos.findIndex((video) => video.id === id);
        if (index === -1) return null;
        return videos.splice(index, 1)[0];
      });
    },
  };
}
