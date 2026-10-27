import apiClient from "../../../api/api.client";

// NOTE: The standalone global error handler interceptor from this file has been safely shifted 
// into your centralized `src/api/api.client.js` instance to protect all outgoing endpoints.

/**
 * @description Service to generate interview report based on user self description, resume and job description.
 */
export const generateInterviewReport = async ({ jobDescription, selfDescription, resumeFile }) => {
    const formData = new FormData();
    formData.append("jobDescription", jobDescription);
    formData.append("selfDescription", selfDescription);
    formData.append("resume", resumeFile);

    const response = await apiClient.post("/api/interview/", formData, {
        headers: {
            "Content-Type": "multipart/form-data"
        }
    });

    return response.data;
};

/**
 * @description Service to get interview report by interviewId.
 */
export const getInterviewReportById = async (interviewId) => {
    const response = await apiClient.get(`/api/interview/report/${interviewId}`);
    return response.data;
};

/**
 * @description Service to get all interview reports of logged in user.
 */
export const getAllInterviewReports = async () => {
    const response = await apiClient.get("/api/interview/");
    return response.data;
};

export const getPreparationProgress = async (interviewId) => {
    const response = await apiClient.get(`/api/interview/${interviewId}/preparation-progress`);
    return response.data;
};

export const updatePreparationTask = async (interviewId, taskId, completed) => {
    const response = await apiClient.patch(
        `/api/interview/${interviewId}/preparation-progress/${taskId}`,
        { completed }
    );
    return response.data;
};

export const createSkillGapPracticeSession = async (interviewId, skill) => {
    const response = await apiClient.post(
        `/api/interview/${interviewId}/practice-sessions`,
        { skill }
    );
    return response.data;
};

export const submitSkillGapPracticeAnswer = async (interviewId, sessionId, questionId, answer) => {
    const response = await apiClient.post(
        `/api/interview/${interviewId}/practice-sessions/${sessionId}/answers`,
        { questionId, answer }
    );
    return response.data;
};

/**
 * @description Service to generate resume pdf based on user data.
 */
// 🟢 CLEANED NAME SIGNATURE: Dropped "Service" suffix for interface naming convention uniformity
export const generateResumePdf = async (interviewReportId) => {
    const response = await apiClient.post(`/api/interview/resume/pdf/${interviewReportId}`, {}, {
        responseType: "blob"
    });

    return response.data;
};