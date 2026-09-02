// Thin wrapper over LeetCode's public GraphQL endpoint.
//
// Called from the service worker, which holds host permissions, so the user's
// existing session cookie authenticates the request. We never read, store, or
// transmit that cookie ourselves.

export const HOSTS = {
  'leetcode.com': 'https://leetcode.com',
  'leetcode.cn': 'https://leetcode.cn',
};

async function gql(host, query, variables = {}) {
  const res = await fetch(`${host}/graphql/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`LeetCode GraphQL responded ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message || 'GraphQL error');
  return json.data;
}

export async function fetchUserStatus(host) {
  const data = await gql(host, `query { userStatus { username isSignedIn } }`);
  return data?.userStatus || { username: null, isSignedIn: false };
}

export async function fetchRecentAccepted(host, username, limit = 20) {
  const data = await gql(
    host,
    `query recentAc($username: String!, $limit: Int) {
       recentAcSubmissionList(username: $username, limit: $limit) {
         id title titleSlug timestamp
       }
     }`,
    { username, limit },
  );
  return data?.recentAcSubmissionList || [];
}

export async function fetchQuestion(host, titleSlug) {
  const data = await gql(
    host,
    `query question($titleSlug: String!) {
       question(titleSlug: $titleSlug) {
         questionFrontendId title titleSlug difficulty
         topicTags { name slug }
       }
     }`,
    { titleSlug },
  );
  return data?.question || null;
}
