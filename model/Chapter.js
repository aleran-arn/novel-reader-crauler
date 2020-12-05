const mongoose = require('mongoose');

const chapterSchema = mongoose.Schema({
    novelId: {
        type: String,
        required: true,
        index: true,
    },
    chapterId: {
        type: String,
        required: true,
        index: true,
    },
    number: {
        type: Number,
        required: true,
        index: true,
    },
    title: {
        type: String,
        required: true,
    },
    prevChapterHref: {
        type: String,
    },
    prevChapterId: {
        type: String,
        index: true,
    },
    content: {
        type: String,
        required: true,
    },
    isBroken: {
        type: Boolean
    }
});

// Export Chapter Model
const Chapter = module.exports = mongoose.model('chapters', chapterSchema);
module.exports.get = function (novelId, chapterNumber) {
    return Chapter.findOne({ novelId: novelId, number: chapterNumber }).exec();
};

module.exports.getNovelChapterIds = async function (novelId) {
    const chapters = await Chapter.find({ novelId: novelId })
        .select('chapterId')
        .exec();
    var chapterNumberSet = new Set();
    for (const chapter of chapters) {
        chapterNumberSet.add(chapter.chapterId);
    }
    return chapterNumberSet;
};