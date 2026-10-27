const mongoose = require('mongoose');

const practiceQuestionSchema = new mongoose.Schema({
    questionId: { type: String, required: true },
    question: { type: String, required: true },
    intent: { type: String, required: true },
    idealAnswerCore: { type: String, required: true }
}, { _id: false });

const practiceSessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    reportId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InterviewReport',
        required: true,
        index: true
    },
    skill: { type: String, required: true },
    questions: { type: [practiceQuestionSchema], required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });

module.exports = mongoose.model('PracticeSession', practiceSessionSchema);
