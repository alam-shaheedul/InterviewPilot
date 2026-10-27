import { useState } from "react";
import {
    createSkillGapPracticeSession,
    submitSkillGapPracticeAnswer
} from "../services/interview.api";

export default function SkillGapPractice({ interviewId, skillGaps = [] }) {
    const skills = [...new Set(skillGaps.map(gap => gap?.skill).filter(Boolean))];
    const [selectedSkill, setSelectedSkill] = useState(skills[0] || "");
    const [session, setSession] = useState(null);
    const [questionIndex, setQuestionIndex] = useState(0);
    const [answer, setAnswer] = useState("");
    const [feedback, setFeedback] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const startPractice = async () => {
        setLoading(true);
        setError("");
        setNotice("");
        setSession(null);
        setFeedback(null);
        setAnswer("");
        setQuestionIndex(0);

        try {
            const response = await createSkillGapPracticeSession(interviewId, selectedSkill);
            setSession(response.data);
            setNotice("Practice questions are ready.");
        } catch (requestError) {
            setError(
                requestError.response?.data?.message ||
                requestError.message ||
                "Could not generate practice questions."
            );
        } finally {
            setLoading(false);
        }
    };

    const submitAnswer = async (event) => {
        event.preventDefault();
        const question = session?.questions?.[questionIndex];
        if (!question || !answer.trim()) return;

        setLoading(true);
        setError("");
        setNotice("");
        try {
            const response = await submitSkillGapPracticeAnswer(
                interviewId,
                session.sessionId,
                question.questionId,
                answer.trim()
            );
            setFeedback(response.data);
            setNotice("Answer evaluated.");
        } catch (requestError) {
            setError(
                requestError.response?.data?.message ||
                requestError.message ||
                "Could not evaluate your answer."
            );
        } finally {
            setLoading(false);
        }
    };

    const moveToNextQuestion = () => {
        setQuestionIndex(index => index + 1);
        setAnswer("");
        setFeedback(null);
        setNotice("");
        setError("");
    };

    if (!skills.length) return null;

    const question = session?.questions?.[questionIndex];
    const finished = session && !question;

    return (
        <section className="practice-drills" aria-labelledby="practice-drills-title">
            <h3 id="practice-drills-title">Skill-Gap Practice</h3>
            <label className="practice-drills__label" htmlFor="practice-skill">
                Choose a skill gap
            </label>
            <div className="practice-drills__controls">
                <select
                    id="practice-skill"
                    value={selectedSkill}
                    onChange={event => {
                        setSelectedSkill(event.target.value);
                        setSession(null);
                        setFeedback(null);
                        setError("");
                        setNotice("");
                    }}
                    disabled={loading}
                >
                    {skills.map(skill => <option key={skill} value={skill}>{skill}</option>)}
                </select>
                <button
                    type="button"
                    className="button primary-button"
                    onClick={startPractice}
                    disabled={loading || !selectedSkill}
                >
                    {loading && !session ? "Generating..." : "Start Practice"}
                </button>
            </div>

            {error && <p className="practice-drills__message practice-drills__message--error" role="alert">{error}</p>}
            {notice && <p className="practice-drills__message" role="status">{notice}</p>}

            {question && (
                <form className="practice-drills__question" onSubmit={submitAnswer}>
                    <p className="practice-drills__count">
                        Question {questionIndex + 1} of {session.questions.length}
                    </p>
                    <h4>{question.question}</h4>
                    <p className="practice-drills__intent">{question.intent}</p>
                    {!feedback ? (
                        <>
                            <label className="practice-drills__label" htmlFor="practice-answer">
                                Your answer
                            </label>
                            <textarea
                                id="practice-answer"
                                value={answer}
                                onChange={event => setAnswer(event.target.value)}
                                maxLength={5000}
                                rows={5}
                                required
                                disabled={loading}
                            />
                            <button
                                type="submit"
                                className="button primary-button"
                                disabled={loading || !answer.trim()}
                            >
                                {loading ? "Evaluating..." : "Submit Answer"}
                            </button>
                        </>
                    ) : (
                        <div className="practice-drills__feedback">
                            <p><strong>Score:</strong> {feedback.score}% — {feedback.verdict}</p>
                            <p>{feedback.critique}</p>
                            {feedback.strengths.length > 0 && (
                                <div>
                                    <strong>Strengths</strong>
                                    <ul>{feedback.strengths.map((item, index) => <li key={index}>{item}</li>)}</ul>
                                </div>
                            )}
                            {feedback.gapsToFill.length > 0 && (
                                <div>
                                    <strong>To improve</strong>
                                    <ul>{feedback.gapsToFill.map((item, index) => <li key={index}>{item}</li>)}</ul>
                                </div>
                            )}
                            <button
                                type="button"
                                className="button primary-button"
                                onClick={moveToNextQuestion}
                            >
                                {questionIndex + 1 < session.questions.length ? "Next Question" : "Finish Practice"}
                            </button>
                        </div>
                    )}
                </form>
            )}

            {finished && <p className="practice-drills__message" role="status">Practice set complete.</p>}
        </section>
    );
}
