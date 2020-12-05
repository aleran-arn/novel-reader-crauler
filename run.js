const util = require('util');
const conf = require('./config/conf');
const got = require('got');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const { BlobServiceClient } = require('@azure/storage-blob');

const Novel = require('./model/Novel');
const Chapter = require('./model/Chapter');
const chapterIdRegexp = new RegExp('.*\\/(.+).html');
const maxPage = 5;

const blobServiceClient = BlobServiceClient.fromConnectionString(conf.azureStoregeUrl);
// Get a reference to a container
const containerClient = blobServiceClient.getContainerClient(conf.azureStorageCoverContainer);

run();

async function run() {
	const options = { useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true };
	const connection = await mongoose.connect(conf.mongoUrl, options);
	const pageArray = [];
	for (let index = maxPage; index >= 0; index--) {
		pageArray.push(index);
	}
	try {
		for (const page of pageArray) {
			const loadResult = await got(conf.novelreader + util.format(conf.lastNovelReaderPath, page), { timeout: 10000 });
			const $ = cheerio.load(loadResult.body);
			for (const element of $('div.col-truyen-main div.row').toArray().reverse()) {
				const novelHref = $(element).find('.truyen-title a').attr('href');
				if (novelHref == null) {
					throw new Error("novelHref not found");
				}
				const chapterHref = $(element).find('.text-info a').attr('href');
				const chapterTitle = $(element).find('.text-info span').text();
				const chapterId = getChapterId(chapterHref);
				if (chapterId == null) {
					console.log('skip chapter ' + chapterHref);
					return;
				}
				const novelId = getNovelIdFromHref(novelHref);

				await saveNovel(novelId, novelHref, chapterTitle, chapterId, chapterHref);
			}
		}
	} catch (err) {
		console.log(err);
	}
	mongoose.connection.close(function () {
		console.log('Mongoose default connection disconnected through app termination');
		process.exit(0);
	});
}



async function saveNovel(novelId, novelHref, chapterTitle, chapterId, chapterHref) {
	var dbNovel = await Novel.getById(novelId);

	if (dbNovel == null) {
		var novel = new Novel();
		novel.novelId = novelId;
		await fillNovelData(novel, novelHref);
		novel.lastChapterId = chapterId;
		novel.lastChapterTitle = chapterTitle;
		novel.lastChapterUpdate = Date.now();

		dbNovel = novel;
	}
	await loadNovelChapters(dbNovel, chapterId, chapterTitle, chapterHref);
	await dbNovel.save();
}

async function fillNovelData(novel, novelHref) {
	const loadPage = await got(conf.novelreader + novelHref, { timeout: 10000 });
	const $ = cheerio.load(loadPage.body);
	const title = $('div.books .title').text();
	const description = $('div.desc-text').text();
	const coverHref = $('div.books img').attr('src');

	const loadCover = await got(conf.novelreader + coverHref, { timeout: 10000, responseType: 'buffer' });
	const saveCoverResponse = await containerClient.uploadBlockBlob(novel.novelId + ".jpg", loadCover.body, loadCover.body.length,
		{ blobHTTPHeaders: { blobContentType: loadCover.headers["content-type"] } });
	if (saveCoverResponse.response.requestId == null) {
		throw new Error("cover not saved");
	}
	novel.coverHref = conf.azureStorageAccessUrl + '/' + conf.azureStorageCoverContainer + '/' + novel.novelId + ".jpg";
	novel.title = title;
	novel.description = description;
}

async function loadNovelChapters(dbNovel, chapterId, chapterTitle, chapterHref) {
	if (chapterId == null) {
		throw new Error("chapterNumber not found");
	}

	const chapterIds = await Chapter.getNovelChapterIds(dbNovel.novelId);
	var currentId = chapterId;
	var currentChapterHref = chapterHref;
	var addedChapterIds = [];
	while (currentId != null) {
		if (chapterIds.has(currentId)) {
			console.log("stop downloading chapters for novel " + dbNovel.novelId + " and chapter " + currentId);
			break;
		}
		addedChapterIds.push(currentId);
		const loadedChapter = await loadChapter(dbNovel.novelId, currentId, currentChapterHref);
		try {
			await loadedChapter.save();
		} catch (err) {
			console.log("Error in chapter " + currentId + " from novel " + dbNovel.novelId);
			throw err;
		}
		currentChapterHref = loadedChapter.prevChapterHref;
		currentId = getChapterId(currentChapterHref);
	}

	console.log("loaded " + addedChapterIds.length + " chapters for novel " + dbNovel.novelId);

	//fill in numbers
	var chapters = await Chapter.find({ chapterId: { $in: addedChapterIds } })
		.select('novelId chapterId prevChapterHref number')
		.exec();
	let chapterMap = new Map();
	for (let chapter of chapters) {
		chapterMap.set(chapter.chapterId, chapter);
	}

	let prevChapter = chapterMap.get(addedChapterIds[0]);
	let lastNumber = 0;
	if (prevChapter != null && prevChapter.prevChapterHref != null) {
		let lastChapter = await Chapter.findOne({ chapterId: getChapterId(prevChapter.prevChapterHref) })
			.select('number')
			.exec();
		lastNumber = lastChapter.number;
	}

	for (let index = addedChapterIds.length - 1; index >= 0; index--) {
		lastNumber++;
		const chapterId = addedChapterIds[index];
		const chapter = chapterMap.get(chapterId);
		if (chapter.number == 0) {
			chapter.number = lastNumber;
		}
		await chapter.save();
		await sleep(100);
	}

	if (chapterId != dbNovel.lastChapterId) {
		dbNovel.lastChapterId = chapterId;
		dbNovel.lastChapterTitle = chapterTitle;
		dbNovel.lastChapterUpdate = Date.now();
	}
}

async function loadChapter(novelId, chapterId, chapterHref) {
	const chapter = new Chapter();

	const loadChapter = await got(conf.novelreader + chapterHref, { timeout: 10000 });
	const $ = cheerio.load(loadChapter.body);
	const chapterTitle = $('a.chapter-title').text();
	const prevChapterHref = $('a#prev_chap').length == 0 ? null : $('a#prev_chap').attr('href');
	const blocks = $('div.chapter-c p');
	var chapterContent = "";
	blocks.each((index, block) => {
		var text = $(block).text();
		if (text != "") {
			chapterContent = chapterContent + "\n" + text;
		}
	});
	chapter.novelId = novelId;
	chapter.chapterId = chapterId;
	chapter.number = 0; //set fake number, fill in later
	chapter.title = chapterTitle;
	chapter.prevChapterHref = prevChapterHref;
	chapter.prevChapterId = getChapterId(prevChapterHref);
	chapter.content = chapterContent;
	if (chapter.content == null || chapter.content.trim() === "") {
		chapter.content = "Broken Content";
		chapter.isBroken = true;
	}
	chapter.createdTime = Date.now();
	return chapter;
}

function getChapterId(chapterHref) {
	if (chapterHref == null) {
		return null;
	}
	return chapterHref.match(chapterIdRegexp)[1];
}

function getNovelIdFromHref(href) {
	if (href == null) {
		return null;
	}
	return href.replace("/", "").replace(".html", "");
}

async function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
} 