const util = require('util');
const conf = require('../config/conf');
const got = require('got');
const cheerio = require('cheerio');
const mongoose = require('mongoose');


const Novel = require('../model/Novel');
const Chapter = require('../model/Chapter');
const chapterIdRegexp = new RegExp('.*\\/(.+).html');

run();

async function run() {
	const options = { useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true };
	await mongoose.connect(conf.mongoUrl, options);

	try {
		const novels = await Novel.find()
			.select('novelId')
			.exec();
		for (let novel of novels) {
			var chapters = await Chapter.find({ novelId: novel.novelId })
			.select('prevChapterHref')
			.exec();
			for (let chapter of chapters) {
				chapter.prevChapterId = getChapterId(chapter.prevChapterHref);
				await chapter.save();
				await sleep(100);
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

function getChapterId(chapterHref) {
	if (chapterHref == null) {
		return null;
	}
	return chapterHref.match(chapterIdRegexp)[1];
}

async function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
} 