const { request } = require("@octokit/request");
const {
  formatDistanceToNow,
  parseJSON,
  isBefore,
  subHours,
} = require("date-fns");

const auth = process.env.ACCESS_TOKEN;
const owner = process.env.OWNER;
const repo = process.env.REPO;
const teamIdentifier = process.env.TEAM_IDENTIFIER;
const warnThresholdInHours = process.env.WARN_THRESHOLD_IN_HOURS;
const sloThresholdInHours = process.env.SLO_THRESHOLD_IN_HOURS;
const sloCutoff = subHours(new Date(), sloThresholdInHours);
const warnCutoff = subHours(new Date(), warnThresholdInHours);

const headers = {
  authorization: `token ${auth}`,
};

const fetchPullRequests = async (owner, repo) => {
  const result = await request("GET /repos/{owner}/{repo}/pulls", {
    headers,
    owner,
    repo,
  });
  return result.data;
};

const fetchIssueEvents = async (owner, repo, number) => {
  const result = await request(
    "GET /repos/{owner}/{repo}/issues/{issue_number}/events",
    {
      headers,
      owner,
      repo,
      issue_number: number,
    }
  );
  return result.data;
};

const maxReviewRequestTimestamp = async (owner, repo, number) => {
  const issueEvents = await fetchIssueEvents(owner, repo, number);
  return issueEvents.reduce((acc, { event, requested_team, created_at }) => {
    if (
      event === "review_requested" &&
      requested_team &&
      requested_team.slug === teamIdentifier &&
      created_at > acc
    ) {
      return parseJSON(created_at);
    }
    return acc;
  }, "");
};

const doIt = async ({ owner, repo }) => {
  const pullRequests = await fetchPullRequests(owner, repo);
  const byTimestamp = await Promise.all(
    pullRequests
      .filter(({ requested_teams }) =>
        requested_teams.some(({ slug }) => slug === teamIdentifier)
      )
      .map(async ({ number, html_url, title }) => {
        const timestamp = await maxReviewRequestTimestamp(owner, repo, number);
        return {
          url: html_url,
          timestamp,
          age: formatDistanceToNow(timestamp),
          title,
          sloViolated: isBefore(timestamp, sloCutoff),
        };
      })
  );
  const output = [`*${repo} reviews*`];
  byTimestamp
    .filter(({ timestamp }) => isBefore(timestamp, warnCutoff))
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach((pr) =>
      output.push(
        `${pr.sloViolated ? ":rotating_light:" : ":warning:"} <${pr.url}|${
          pr.title
        }> - ${pr.age}`
      )
    );
  console.log(output.join("\n"));
};

doIt({ owner, repo });
