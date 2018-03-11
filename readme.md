# Pexels Downloader

automatically download free images from Pexels.com to create training datasets

## Requirements
* Docker
* Docker-compose

## How to use

### Clone repository and build docker image

```
git clone https://github.com/DeepSystems/pexels_downloader.git
cd pexels_downloader
docker-compose build
```

### Configure download process
To configure download process you have to change some values in `docker-compose.override.yml`

Let's consider following example: you have already use downloader and the previous download results are stored in directories `dataset1` and `dataset2`. And you are going to run new download process and put results to the directory `new_dataset`. So `docker-compose.override.yml` should looks like:

```yaml
version: '2.3'

services:
  downloader:
    command: >
      --downloads 2
      --count 2000
      --timeout 10
      --query person
      --cache-dir /images/cache
      --images-dir /images/result
    volumes:
      - ./new_dataset:/images/result
      - ./dataset1:/images/cache/ds1
      - ./dataset2:/images/cache/ds2
```

Parameters description:
* `downloads` - defines how many images can be downloaded simultaneously

* `count` - number of images you are going to download

* `timeout` - download timeout in seconds

* `query` - search query, in this case we will download images that have tag "person"

* `cache-dir` - we recursively get all images from this directory and then do not download images if they are already in `cache-dir`

* `images-dir` - downloaded images will be stored in this directory

So, in this example we store already downlaoded images in two folders `dataset1` and `dataset2` and mount them to the container. New images we are going to store in `new_dataset`, that is why we mount this host directory to the container as `/images/result` folder.

### Run downloader

If you are going to view logs, just execute command below to start download.
```
docker-compose up
```

If you are going to run download process in the backbround, execute following command:
```
docker-compose up -d
```
