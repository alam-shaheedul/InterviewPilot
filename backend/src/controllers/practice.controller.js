const mongoose = require('mongoose');
const interviewReportModel = require('../models/interviewReport.model.js');
const practiceSessionModel = require('../models/practiceSession.model.js');
const { generatePracticeQuestions, gradePracticeAnswer } = require('../services/ai.service.js');

const MAX_ANSWER_LENGTH = 5000;
const PRACTICE_SESSION_TTL_MS = 30 * 60 * 1000;

function isValidQuestionSet(result) {
    if (!result || !Array.isArray(result.questions) || result.questions.length !== 3) {
        return false;
    }

    const ids = new Set();
    return result.questions.every(question => {
        if (
            !question ||
            typeof question.questionId !== 'string' ||
            !/^[A-Za-z0-9_-]{1,40}$/.test(question.questionId) ||
            typeof question.question !== 'string' ||
            !question.question.trim() ||
            question.question.length > 2000 ||
            typeof question.intent !== 'string' ||
            !question.intent.trim() ||
            question.intent.length > 1000 ||
            typeof question.idealAnswerCore !== 'string' ||
            !question.idealAnswerCore.trim() ||
            question.idealAnswerCore.length > 3000 ||
            ids.has(question.questionId)
        ) {
            return false;
        }
        ids.add(question.questionId);
        return true;
    });
}

function isValidEvaluation(result) {
    return Boolean(
        result &&
        typeof result.score === 'number' &&
        Number.isFinite(result.score) &&
        result.score >= 0 &&
        result.score <= 100 &&
        typeof result.verdict === 'string' &&
        result.verdict.trim() &&
        result.verdict.length <= 200 &&
        typeof result.critique === 'string' &&
        result.critique.trim() &&
        result.critique.length <= 5000 &&
        Array.isArray(result.strengths) &&
        result.strengths.length <= 20 &&
        result.strengths.every(item => typeof item === 'string' && item.length <= 1000) &&
        Array.isArray(result.gapsToFill) &&
        result.gapsToFill.length <= 20 &&
        result.gapsToFill.every(item => typeof item === 'string' && item.length <= 1000)
    );
}

async function generatePracticeSessionController(req, res) {
    const { interviewId } = req.params;
    const userId = req.user?._id || req.user?.id;
    const skill = typeof req.body?.skill === 'string' ? req.body.skill.trim() : '';

    if (!mongoose.Types.ObjectId.isValid(interviewId)) {
        return res.status(404).json({
            status: 'failed',
            message: 'Interview report not found due to an invalid record identifier layout.'
        });
    }
    if (!skill || skill.length > 100) {
        return res.status(400).json({
            status: 'failed',
            message: 'A skill gap name between 1 and 100 characters is required.'
        });
    }

    try {
        const report = await interviewReportModel.findOne({ _id: interviewId, user: userId });
        if (!report) {
            return res.status(404).json({ status: 'failed', message: 'Interview report not found.' });
        }

        const matchingSkill = (report.skillGaps || []).find(
            gap => typeof gap.skill === 'string' && gap.skill.toLowerCase() === skill.toLowerCase()
        );
        if (!matchingSkill) {
            return res.status(400).json({
                status: 'failed',
                message: 'The selected skill is not listed as a gap in this report.'
            });
        }

        let generated;
        try {
            generated = await generatePracticeQuestions(matchingSkill.skill);
        } catch (error) {
            console.error('Practice question generation failed:', error);
            return res.status(502).json({
                status: 'error',
                message: 'Practice questions could not be generated. Please try again.'
            });
        }

        if (!isValidQuestionSet(generated)) {
            console.error('Practice question generation returned an invalid question set.');
            return res.status(502).json({
                status: 'error',
                message: 'Practice questions could not be validated. Please try again.'
            });
        }

        const practiceSession = await practiceSessionModel.create({
            userId,
            reportId: report._id,
            skill: matchingSkill.skill,
            questions: generated.questions,
            expiresAt: new Date(Date.now() + PRACTICE_SESSION_TTL_MS)
        });

        return res.status(201).json({
            status: 'success',
            message: 'Practice questions generated successfully.',
            data: {
                sessionId: practiceSession._id,
                skill: matchingSkill.skill,
                questions: generated.questions.map(({ questionId, question, intent }) => ({
                    questionId,
                    question,
                    intent
                }))
            }
        });
    } catch (error) {
        console.error('Practice session creation failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Practice session could not be created.'
        });
    }
}

async function submitPracticeAnswerController(req, res) {
    const { interviewId, sessionId } = req.params;
    const userId = req.user?._id || req.user?.id;
    const { questionId, answer } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(interviewId) || !mongoose.Types.ObjectId.isValid(sessionId)) {
        return res.status(400).json({ status: 'failed', message: 'The practice session identifier is invalid.' });
    }
    if (typeof questionId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(questionId)) {
        return res.status(400).json({ status: 'failed', message: 'A valid question identifier is required.' });
    }
    if (typeof answer !== 'string' || !answer.trim() || answer.length > MAX_ANSWER_LENGTH) {
        return res.status(400).json({
            status: 'failed',
            message: `An answer between 1 and ${MAX_ANSWER_LENGTH} characters is required.`
        });
    }

    try {
        const report = await interviewReportModel.findOne({ _id: interviewId, user: userId });
        if (!report) {
            return res.status(404).json({ status: 'failed', message: 'Interview report not found.' });
        }

        const practiceSession = await practiceSessionModel.findOne({
            _id: sessionId,
            reportId: report._id,
            userId,
            expiresAt: { $gt: new Date() }
        });
        if (!practiceSession) {
            return res.status(404).json({
                status: 'failed',
                message: 'Practice session was not found or has expired.'
            });
        }

        const question = practiceSession.questions.find(item => item.questionId === questionId);
        if (!question) {
            return res.status(404).json({ status: 'failed', message: 'Practice question not found.' });
        }

        let evaluation;
        try {
            evaluation = await gradePracticeAnswer({
                topic: practiceSession.skill,
                question: question.question,
                intent: question.intent,
                candidateAnswer: answer.trim()
            });
        } catch (error) {
            console.error('Practice answer grading failed:', error);
            return res.status(502).json({
                status: 'error',
                message: 'Your answer could not be evaluated. Please try again.'
            });
        }

        if (!isValidEvaluation(evaluation)) {
            console.error('Practice answer grading returned an invalid evaluation.');
            return res.status(502).json({
                status: 'error',
                message: 'The evaluation could not be validated. Please try again.'
            });
        }

        return res.status(200).json({
            status: 'success',
            message: 'Practice answer evaluated successfully.',
            data: {
                questionId,
                score: evaluation.score,
                verdict: evaluation.verdict,
                critique: evaluation.critique,
                strengths: evaluation.strengths,
                gapsToFill: evaluation.gapsToFill
            }
        });
    } catch (error) {
        console.error('Practice answer submission failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Practice answer could not be submitted.'
        });
    }
}

module.exports = {
    generatePracticeSessionController,
    submitPracticeAnswerController
};
