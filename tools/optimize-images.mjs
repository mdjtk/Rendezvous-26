import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const jobs = [
  {
    name: 'decoding.svg',
    src: 'assets/img/decoding.svg',
    out: 'assets/img/decoding.webp',
    width: 1100,
    quality: 82,
  },
  {
    name: 'BLeaf-.svg',
    src: 'assets/img/BLeaf-.svg',
    out: 'assets/img/bleaf.webp',
    width: 900,
    quality: 82,
  },
  {
    name: 'rendezvous.png',
    src: 'assets/img/rendezvous.png',
    out: 'assets/img/rendezvous.webp',
    height: 128,
    quality: 85,
  },
  {
    name: 'decoding-bw.png',
    src: 'assets/img/decoding-bw.png',
    out: 'assets/img/decoding-bw.webp',
    height: 1600,
    quality: 75,
  },
];

async function run(job) {
  const t = Date.now();
  let img = sharp(job.src, { density: 72 }).resize(
    job.width ? { width: job.width, withoutEnlargement: true } : { height: job.height, withoutEnlargement: true }
  );
  await img.webp({ quality: job.quality, alphaQuality: 90, smartSubsample: true }).toFile(job.out);
  const kb = Math.round((await import('node:fs')).statSync(job.out).size / 1024);
  console.log(`${job.name} -> ${job.out}  ${kb} KB  (${Date.now() - t}ms)`);
}

for (const job of jobs) await run(job);
console.log('done');