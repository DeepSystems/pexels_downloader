global.Promise = require('bluebird');

const fse = require('fs-extra');
const path = require('path');
const axios = require('axios');
const faker = require('faker');
const cheerio = require('cheerio');
const prettyTime = require('pretty-time');

const argv = require('yargs')
    .option('count', {
      alias:        'c',
      describe:     'amount of new images to download',
      demandOption: true,
      type:         'number',
    })
    .option('query', {
      alias:        'q',
      describe:     'search query',
      demandOption: true,
      type:         'string',
    })
    .option('delay', {
      alias:    'd',
      describe: 'delay (ms) between requests',
      default:  1000,
      type:     'number',
    })
    .option('page', {
      alias:    'p',
      describe: 'page to start from',
      default:  1,
      type:     'number',
    })
    .option('images-dir', {
      describe: 'images directory',
      default:  path.join(process.cwd(), 'images', 'result'),
      type:     'string',
    })
    .option('cache-dir', {
      describe: 'images cache directory',
      default:  path.join(process.cwd(), 'images', 'cache'),
      type:     'string',
    })
    .option('downloads', {
      describe: 'concurrent downloads',
      default:  3,
      type:     'number',
    })
    .option('timeout', {
      describe: 'image download timeout (s)',
      default:  60,
      type:     'number',
    })
    .help()
    .argv;

const instance = axios.create({
  baseURL: `http://www.pexels.com/search/${argv.query}`,
  headers: {
    Accept:             '*/*',
    'Accept-Language':  'en;',
    'Cache-Control':    'no-cache, no-store, must-revalidate',
    'Content-Encoding': 'utf-8',
    'Content-Type':     'text/plain;charset=utf-8',
    'User-Agent':       faker.internet.userAgent(),
    Pragma:             'no-cache',
    Expires:            '0',
    DNT:                '1',
    'X-Compress':       'null',
  },
  params:  {
    format: 'js'
  },
});

let imagesCount = 0;
const REQUESTS_DELAY = argv.delay;
const DOWNLOAD_TIMEOUT = argv.timeout * 1000;
const MAX_IMAGES = argv.count;
const imagesDir = argv.imagesDir;
const cacheDir = argv.cacheDir;

const imagesRegex = /\('beforeend',\s*'(.*)'\)/;

function parseImgsFromStr(str) {
  const result = imagesRegex.exec(str);
  if (!result) return null;
  
  return result[1];
}

function getImgTitle(imgUrl) {
  let title = '';
  
  for (let i = imgUrl.length - 1; i >= 0; i--) {
    const curChar = imgUrl.charAt(i);
    if (curChar === '/') break;
    
    title = curChar + title;
  }
  
  return title;
}

function trimExtension(str) {
  return str.replace(/\.[^/.]+$/, '');
}

function mapImg(imgUrl) {
  const filename = getImgTitle(imgUrl);
  
  return {
    url:      imgUrl,
    name: trimExtension(filename),
    filename,
  }
}

function parseImages(str) {
  if (!str) return null;
  
  const $ = cheerio.load(parseImgsFromStr(str));
  const imgs = $('img').map((i, el) => {
    const imgUrl = $(el).attr('srcset').trim().replace('\\"', '');
    return imgUrl.substring(0, imgUrl.indexOf('?'));
  }).get();
  
  return [...new Set(imgs)].filter(img => img).map(mapImg);
}

function saveImages(imgs, concurrency) {
  return Promise.map(imgs, (img) => {
        const savePath = path.join(imagesDir, img.filename);
        console.info(`Saving ${img.url}`);
        const start = process.hrtime();
      
        const imgFileStream = fse.createWriteStream(savePath);
        
        return (new Promise(async (res, rej) => {
          try {
            imgFileStream.on('error', rej);
            
            const { data } = await axios.get(img.url, { responseType: 'stream' });
            data.on('error', rej);
            
            data.pipe(imgFileStream);
            
            imgFileStream.on('finish', () => {
              imagesCount += 1;
              
              console.info(`Saved ${img.url} in ${prettyTime(process.hrtime(start), 'ms')}`, `${imagesCount}/${MAX_IMAGES}`);
              
              res();
            });
          }
          catch (err) {
            rej(err);
          }
        }))
            .timeout(DOWNLOAD_TIMEOUT)
            .catch(Promise.TimeoutError, () => {
              console.error(`Couldn't download file ${img.url} within ${DOWNLOAD_TIMEOUT} seconds`);
              imgFileStream.close();
              
              fse.remove(savePath).catch((err) => {
                console.error(`Couldn't remove failed file ${img.url} in ${savePath}`, err);
              });
            });
      }
      , { concurrency }
  );
}

async function crawlImages(imgsCount, max, cacheSet, page) {
  const result = await instance.get('', { params: { page } }).then(r => r.data);
  
  let imgs = parseImages(result);
  
  if (!imgs || !imgs.length) {
    console.warn(`No images found on page ${page} :(`, result);
  }
  else {
    imgs = imgs.filter(({ name }) => !cacheSet.has(name));
    await saveImages(imgs, argv.downloads);
  }
  
  if (imagesCount < max) {
    await Promise.delay(REQUESTS_DELAY);
    return crawlImages(imagesCount, max, cacheSet, page + 1);
  }
  
  return imgsCount;
}

async function getFilesIndex(dirpath, files = new Set()) {
  const curFiles = await fse.readdir(dirpath);
  
  await Promise.map(curFiles, async (f) => {
    const curPath = path.join(dirpath, f);
    const curStats = await fse.stat(curPath);
    if (curStats.isDirectory()) {
      await getFilesIndex(curPath, files);
      return;
    }
    
    files.add(trimExtension(f));
  }, { concurrency: 1 });
  
  return files;
}

async function main() {
  await fse.ensureDir(imagesDir);
  
  const imgsCnt = (await fse.readdir(imagesDir)).length;
  if (imgsCnt !== 0) {
    console.error(`Images directory "${imagesDir}" is not empty`);
    process.exit(1);
  }
  
  let start = process.hrtime();
  
  console.info(`Building cache index from "${cacheDir}"`);
  const files = await getFilesIndex(cacheDir);
  console.info(`Index has been built: found ${files.size} files in ${prettyTime(process.hrtime(start), 'ms')}`);
  
  start = process.hrtime();
  
  await crawlImages(imagesCount, MAX_IMAGES, files, argv.page);
  console.info(`Downloaded: ${imagesCount} in ${prettyTime(process.hrtime(start), 'ms')}`);
}

main().catch(console.error);
