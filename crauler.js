const util = require('util');
const conf = require('./config/conf');
const got = require('got');
const cheerio = require('cheerio');
const db = require('@novelreader/core/index');

const Novel = require('@novelreader/core/model/Novel');
const Chapter = require('@novelreader/core/model/Chapter');
const chapterIdRegexp = new RegExp('chapter-(\\d+)-?');
const maxPage = 10;

run();

async function run() {
	const mongo = await db.dbConnection;
	try {
		for (const page of Array(maxPage).keys()) {
			const loadResult = await got(conf.novelreader + util.format(conf.lastNovelReaderPath, page), { timeout: 50000 });
			const $ = cheerio.load(loadResult.body);
			for (const element of $('div.col-truyen-main div.row').toArray().reverse()) {
				const novelHref = $(element).find('.truyen-title a').attr('href');
				if (novelHref == null) {
					throw new Error("novelHref not found");
				}
				const chapterHref = $(element).find('.text-info a').attr('href');
				if (chapterHref == null) {
					console.log("element " + element);
					throw new Error("null href");
                }
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
	const loadPage = await got(conf.novelreader + novelHref, { timeout: 50000 });
	const $ = cheerio.load(loadPage.body);
	const title = $('div.books .title').text();
	const description = $('div.desc-text').text();
	const coverHref = $('div.books img').attr('src');

	const loadCover = await got(conf.novelreader + coverHref, { timeout: 50000, responseType: 'buffer' });
	novel.coverImage.data = loadCover.body;
	novel.coverImage.contentType = loadCover.headers["content-type"];

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

	const loadChapter = await got(conf.novelreader + chapterHref, { timeout: 50000 });
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