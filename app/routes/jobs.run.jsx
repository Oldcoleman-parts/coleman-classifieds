import { handleJobsRequest } from "@/modules/scheduler/index.js";

export const loader = ({ request }) => handleJobsRequest(request);
export const action = ({ request }) => handleJobsRequest(request);
