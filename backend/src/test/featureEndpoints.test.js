const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

jest.mock('../config/config.js', () => ({
    jwt: { secret: 'feature_test_secret' },
    mail: {},
    google: { genApiKey: 'test-key' }
}));

jest.mock('../config/redis.js', () => ({
    isOpen: true,
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1)
}));

jest.mock('../services/mail.services.js', () => ({
    verify: jest.fn((callback) => callback(null, true)),
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message' })
}));

jest.mock('../services/ai.service.js', () => ({
    generateInterviewReport: jest.fn(),
    generateTailoredResume: jest.fn(),
    generatePracticeQuestions: jest.fn(),
    gradePracticeAnswer: jest.fn()
}));

jest.mock('../services/resumePdf.service.js', () =>
    jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test'))
);

const User = require('../models/user.model.js');
const InterviewReport = require('../models/interviewReport.model.js');
const PracticeSession = require('../models/practiceSession.model.js');
jest.mock('../models/user.model.js');
jest.mock('../models/interviewReport.model.js');
jest.mock('../models/practiceSession.model.js');

const {
    generatePracticeQuestions,
    gradePracticeAnswer
} = require('../services/ai.service.js');
const app = require('../app.js');

describe('Preparation progress and skill-gap practice endpoints', () => {
    const userId = new mongoose.Types.ObjectId();
    const reportId = new mongoose.Types.ObjectId();
    const sessionId = new mongoose.Types.ObjectId();
    const token = jwt.sign({ _id: userId.toString(), tokenVersion: 1 }, 'feature_test_secret');
    const questions = [
        { questionId: 'q1', question: 'Explain a cluster.', intent: 'Architecture', idealAnswerCore: 'Nodes coordinate.' },
        { questionId: 'q2', question: 'Explain a pod.', intent: 'Scheduling', idealAnswerCore: 'A pod groups containers.' },
        { questionId: 'q3', question: 'Explain a service.', intent: 'Networking', idealAnswerCore: 'A service routes traffic.' }
    ];
    let report;

    const authenticate = () => {
        User.findById.mockReturnValue({
            select: jest.fn().mockResolvedValue({ _id: userId, tokenVersion: 1 })
        });
    };

    const withCookie = (requestBuilder) => requestBuilder.set('Cookie', [`token=${token}`]);

    beforeEach(() => {
        jest.clearAllMocks();
        authenticate();
        report = {
            _id: reportId,
            user: userId,
            skillGaps: [{ skill: 'Kubernetes', severity: 'medium' }],
            preparationPlan: [
                { day: 'Day 1', tasks: ['Read docs', 'Build a sample'] },
                { day: 'Day 2', tasks: ['Review deployment'] }
            ],
            preparationProgress: new Map(),
            save: jest.fn().mockResolvedValue(true)
        };
        InterviewReport.findOne = jest.fn().mockResolvedValue(report);
        PracticeSession.create = jest.fn().mockResolvedValue({ _id: sessionId });
        PracticeSession.findOne = jest.fn().mockResolvedValue({
            _id: sessionId,
            userId,
            reportId,
            skill: 'Kubernetes',
            expiresAt: new Date(Date.now() + 60_000),
            questions
        });
        generatePracticeQuestions.mockResolvedValue({ topic: 'Kubernetes', questions });
        gradePracticeAnswer.mockResolvedValue({
            score: 82,
            verdict: 'Strong Pass',
            critique: 'A clear explanation.',
            strengths: ['Named the core components.'],
            gapsToFill: ['Mention service discovery.'],
            idealAnswerCore: 'This extra provider field must never reach the client.'
        });
    });

    it('requires authentication for progress and practice endpoints', async () => {
        const progress = await request(app).get(`/api/interview/${reportId}/preparation-progress`);
        const practice = await request(app).post(`/api/interview/${reportId}/practice-sessions`).send({ skill: 'Kubernetes' });

        expect(progress.status).toBe(401);
        expect(practice.status).toBe(401);
    });

    it('retrieves task progress and reports the completed count and percentage', async () => {
        report.preparationProgress.set('day-0-task-0', true);

        const response = await withCookie(
            request(app).get(`/api/interview/${reportId}/preparation-progress`)
        );

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
            completedTasks: 1,
            totalTasks: 3,
            progressPercent: 33
        });
        expect(response.body.data.tasks[0]).toMatchObject({
            taskId: 'day-0-task-0',
            completed: true
        });
    });

    it('persists a task toggle without replacing the generated report data', async () => {
        const response = await withCookie(
            request(app)
                .patch(`/api/interview/${reportId}/preparation-progress/day-1-task-0`)
                .send({ completed: true })
        );

        expect(response.status).toBe(200);
        expect(report.preparationProgress.get('day-1-task-0')).toBe(true);
        expect(report.save).toHaveBeenCalledTimes(1);
        expect(report.preparationPlan[1].tasks[0]).toBe('Review deployment');
        expect(response.body.data).toMatchObject({
            completedTasks: 1,
            totalTasks: 3,
            progressPercent: 33
        });
    });

    it('rejects invalid and nonexistent task identifiers and non-boolean completion values', async () => {
        const invalidId = await withCookie(
            request(app)
                .patch(`/api/interview/${reportId}/preparation-progress/not-a-task`)
                .send({ completed: true })
        );
        const unknownTask = await withCookie(
            request(app)
                .patch(`/api/interview/${reportId}/preparation-progress/day-9-task-0`)
                .send({ completed: true })
        );
        const invalidValue = await withCookie(
            request(app)
                .patch(`/api/interview/${reportId}/preparation-progress/day-0-task-0`)
                .send({ completed: 'true' })
        );

        expect(invalidId.status).toBe(400);
        expect(unknownTask.status).toBe(404);
        expect(invalidValue.status).toBe(400);
        expect(report.save).not.toHaveBeenCalled();
    });

    it('rejects progress access to a report not owned by the user', async () => {
        InterviewReport.findOne.mockResolvedValueOnce(null);

        const response = await withCookie(
            request(app).get(`/api/interview/${reportId}/preparation-progress`)
        );

        expect(response.status).toBe(404);
    });

    it('generates report-specific practice questions without returning ideal answers', async () => {
        const response = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions`)
                .send({ skill: 'Kubernetes' })
        );

        expect(response.status).toBe(201);
        expect(generatePracticeQuestions).toHaveBeenCalledWith('Kubernetes');
        expect(PracticeSession.create).toHaveBeenCalledWith(expect.objectContaining({
            userId,
            reportId,
            skill: 'Kubernetes',
            expiresAt: expect.any(Date)
        }));
        expect(response.body.data.questions).toHaveLength(3);
        expect(response.body.data.questions[0]).not.toHaveProperty('idealAnswerCore');
    });

    it('rejects skills that are not gaps in the selected report', async () => {
        const response = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions`)
                .send({ skill: 'Rust' })
        );

        expect(response.status).toBe(400);
        expect(generatePracticeQuestions).not.toHaveBeenCalled();
    });

    it('rejects practice generation for a report not owned by the user', async () => {
        InterviewReport.findOne.mockResolvedValueOnce(null);

        const response = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions`)
                .send({ skill: 'Kubernetes' })
        );

        expect(response.status).toBe(404);
        expect(generatePracticeQuestions).not.toHaveBeenCalled();
    });

    it('does not create a practice session when AI generation fails or returns invalid questions', async () => {
        generatePracticeQuestions.mockRejectedValueOnce(new Error('Provider unavailable'));
        const failedAI = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions`)
                .send({ skill: 'Kubernetes' })
        );

        generatePracticeQuestions.mockResolvedValueOnce({
            questions: [{ questionId: 'q1', question: 'Incomplete question' }]
        });
        const malformedAI = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions`)
                .send({ skill: 'Kubernetes' })
        );

        expect(failedAI.status).toBe(502);
        expect(malformedAI.status).toBe(502);
        expect(PracticeSession.create).not.toHaveBeenCalled();
    });

    it('grades an answer using server-held context and returns validated feedback only', async () => {
        const response = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions/${sessionId}/answers`)
                .send({ questionId: 'q1', answer: 'A cluster contains coordinated nodes.' })
        );

        expect(response.status).toBe(200);
        expect(gradePracticeAnswer).toHaveBeenCalledWith({
            topic: 'Kubernetes',
            question: questions[0].question,
            intent: questions[0].intent,
            candidateAnswer: 'A cluster contains coordinated nodes.'
        });
        expect(response.body.data.score).toBe(82);
        expect(response.body.data).not.toHaveProperty('idealAnswerCore');
    });

    it('rejects malformed answers and unknown question identifiers', async () => {
        const emptyAnswer = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions/${sessionId}/answers`)
                .send({ questionId: 'q1', answer: '  ' })
        );
        const tooLongAnswer = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions/${sessionId}/answers`)
                .send({ questionId: 'q1', answer: 'a'.repeat(5001) })
        );
        const unknownQuestion = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions/${sessionId}/answers`)
                .send({ questionId: 'q99', answer: 'Answer' })
        );

        expect(emptyAnswer.status).toBe(400);
        expect(tooLongAnswer.status).toBe(400);
        expect(unknownQuestion.status).toBe(404);
        expect(gradePracticeAnswer).not.toHaveBeenCalled();
    });

    it('rejects grading requests for expired or foreign practice sessions', async () => {
        PracticeSession.findOne.mockResolvedValueOnce(null);

        const response = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions/${sessionId}/answers`)
                .send({ questionId: 'q1', answer: 'Answer' })
        );

        expect(response.status).toBe(404);
        expect(gradePracticeAnswer).not.toHaveBeenCalled();
    });

    it('returns an explicit error when AI grading fails or returns an invalid score', async () => {
        gradePracticeAnswer.mockRejectedValueOnce(new Error('Provider unavailable'));
        const failedAI = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions/${sessionId}/answers`)
                .send({ questionId: 'q1', answer: 'Answer' })
        );

        gradePracticeAnswer.mockResolvedValueOnce({
            score: 101,
            verdict: 'Pass',
            critique: 'Not valid',
            strengths: [],
            gapsToFill: []
        });
        const malformedAI = await withCookie(
            request(app)
                .post(`/api/interview/${reportId}/practice-sessions/${sessionId}/answers`)
                .send({ questionId: 'q1', answer: 'Answer' })
        );

        expect(failedAI.status).toBe(502);
        expect(malformedAI.status).toBe(502);
        expect(failedAI.body.data).toBeUndefined();
        expect(malformedAI.body.data).toBeUndefined();
    });
});
