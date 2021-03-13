const util = require('util');
const conf = require('./config/conf');
const got = require('got');
const cheerio = require('cheerio');
const db = require('@novelreader/core/index');

const Novel = require('../novel-reader-core/model/Novel');
const Chapter = require('../novel-reader-core/model/Chapter');
const chapterIdRegexp = new RegExp('chapter-(\\d+)-?');
const maxPage = 10;

async function run() {
	const mongo = await db.dbConnection;
	try {
		for (const page of Array(maxPage).keys()) {
			const loadResult = await got(conf.novelreader + util.format(conf.lastNovelReaderPath, page), { timeout: 50000 });
			const $ = cheerio.load(loadResult.body);
			for (const element of $('div.col-truyen-main div.row').toArray()) {
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
				const chapterNumber = getChapterNumber(chapterHref);
				const novelId = getNovelIdFromHref(novelHref);

				await saveNovel(novelId, novelHref, chapterTitle, chapterNumber, chapterHref);
			}
		}
	} catch (err) {
		console.log(err);
	}
	mongo.close(function () {
		console.log('Mongoose default connection disconnected through app termination');
		process.exit(0);
	});
}



async function saveNovel(novelId, novelHref, chapterTitle, chapterNumber, chapterHref) {
	var dbNovel = await Novel.getById(novelId);

	if (dbNovel == null) {
		var novel = new Novel();
		novel.novelId = novelId;
		await fillNovelData(novel, novelHref);
		novel.lastChapterNumber = chapterNumber;
		novel.lastChapterTitle = chapterTitle;
		novel.lastChapterUpdate = Date.now();

		dbNovel = novel;
	}
	await loadNovelChapters(dbNovel, chapterNumber, chapterTitle, chapterHref);
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

async function loadNovelChapters(dbNovel, chapterNumber, chapterTitle, chapterHref) {
	const parsedChapterNumber = parseInt(chapterNumber);
	if (parsedChapterNumber == null) {
		throw new Error("parsedChapterNumber not found");
	}

	const chapterNumbers = await Chapter.getNovelChapterNumbers(dbNovel.novelId);
	var currentNumber = parsedChapterNumber;
	var currentChapterHref = chapterHref;
	while (currentNumber > 0 && currentChapterHref != null) {
		if (chapterNumbers.has(currentNumber)) {
			break;
		}
		const loadedChapter = await loadChapter(dbNovel.novelId, currentNumber, currentChapterHref);
		await loadedChapter.save();
		currentChapterHref = loadedChapter.prevChapterHref;
		currentNumber--;
	}

	if (currentNumber > 0) {
		console.log("something wrong with numbers in novel " + dbNovel.novelId);
		console.log("number " + currentNumber);
    }

	if (parsedChapterNumber > dbNovel.lastChapterNumber) {
		dbNovel.lastChapterNumber = chapterNumber;
		dbNovel.lastChapterTitle = chapterTitle;
		dbNovel.lastChapterUpdate = Date.now();
	}
}

async function saveChapter(novelId, chapterNumber, chapterHref) {
	const dbChapter = await Chapter.get(novelId, chapterNumber);
	if (dbChapter != null) {
		return;
	}

	const chapter = new Chapter();

	const loadedChapter = await loadChapter(novelId, chapterNumber, chapterHref);
	await loadedChapter.save();
}

async function loadChapter(novelId, chapterNumber, chapterHref) {
	const chapter = new Chapter();

	const loadChapter = await got(conf.novelreader + chapterHref, { timeout: 50000 });
	const $ = cheerio.load(loadChapter.body);
	const chapterTitle = $('a.chapter-title').text();
	const prevChapterHref = $('a#prev_chap').attr('href');
	const blocks = $('div.chapter-c p');
	var chapterContent = "";
	blocks.each((index, block) => {
		var text = $(block).text();
		if (text != "") {
			chapterContent = chapterContent + "\n" + text;
		}
	});
	chapter.novelId = novelId;
	chapter.number = chapterNumber;
	chapter.title = chapterTitle;
	chapter.prevChapterHref = prevChapterHref;
	chapter.content = chapterContent;
	return chapter;
}

function getChapterNumber(chapterHref) {
	return chapterHref.match(chapterIdRegexp)[1];
}

async function getChapterContent(chapterHref) {

}

function getNovelIdFromHref(href) {
	return href.replace("/", "").replace(".html", "");
}
