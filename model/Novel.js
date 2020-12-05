const mongoose = require('mongoose');

const novelSchema = mongoose.Schema({
    novelId: {
        type: String,
        index: true,
        unique: true
    },
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
    },
    coverHref: {
        type: String,
        required: true,
    },
    lastChapterId: {
        type: String,
        required: true,
    },
    lastChapterTitle: {
        type: String,
        required: true,
    },
    lastChapterUpdate: {
        type: Date,
        required: true,
        index: true,
    }
},
{
    bufferCommands: false,
});

// Export Novel Model
const Novel = module.exports = mongoose.model('novels', novelSchema);
module.exports.get = function (limit) {
    return Novel.find().sort({ lastChapterUpdate: 'desc' }).limit(limit).exec();
};

module.exports.getById = function (novelId) {
    return Novel.findOne({ novelId: novelId }).exec();
};