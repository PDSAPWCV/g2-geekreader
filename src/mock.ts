// Sample data for `?mock=1`: made-up topics shaped like feed items, so the lens
// layout and gestures can be tried without any network. Not real GeekNews content.

import type { FeedItem } from '../shared/feed';

const SAMPLES: Array<{ title: string; author: string; bullets: string[]; truncated: boolean }> = [
  {
    title: '샘플 글 1 - 제목이 두 줄로 넘어갈 만큼 긴 경우에 안경 화면에서 어떻게 보이는지 확인',
    author: 'sample',
    bullets: [
      '이 글은 화면 배치를 확인하기 위한 샘플 데이터로, 실제 긱뉴스 글이 아님',
      '요약은 보통 다섯 줄 안팎의 글머리표로 이루어지고, 한 줄이 꽤 길어서 안경에서는 두세 줄로 나뉨',
      '영문과 숫자가 섞인 경우도 확인함: TypeScript 6.0, HTTP/3, 576x288 px',
      '`code` 표기나 괄호(예: 이런 것)도 폭 계산에 포함됨',
      '피드는 요약을 300자쯤에서 자르기 때문에 마지막 줄은 이렇게 끝남…',
    ],
    truncated: true,
  },
  {
    title: '샘플 글 2 - 짧은 제목',
    author: 'sample',
    bullets: ['요약이 아주 짧은 글', '두 줄뿐이라 읽기 화면도 한 쪽으로 끝남'],
    truncated: false,
  },
  {
    title: 'Sample topic 3 - an English title to check Latin glyph widths on the lens',
    author: 'sample',
    bullets: [
      'English summaries wrap at spaces, so long words such as internationalization stay whole',
      '한글과 English가 한 줄에 섞여도 줄바꿈이 어절 단위로 일어나는지 확인',
      '세 번째 줄',
      '네 번째 줄은 조금 더 길게 써서 읽기 화면이 두 쪽이 되도록 함. 이 정도면 충분히 길어짐',
    ],
    truncated: false,
  },
  {
    title: '샘플 글 4 - 요약이 없는 글',
    author: 'sample',
    bullets: [],
    truncated: false,
  },
  {
    title: '샘플 글 5 - 하루가 지난 글',
    author: 'sample',
    bullets: ['보여줄 범위를 24시간으로 두면 이 글은 목록에 나오지 않음', '범위를 3일로 바꾸면 나타남'],
    truncated: false,
  },
];

/** Minutes ago each sample was "published". The last one is older than a day. */
const AGE_MIN = [5, 42, 180, 600, 30 * 60];

export function mockItems(now = Date.now()): FeedItem[] {
  return SAMPLES.map((s, i) => {
    const id = 900_000 - i;
    return {
      id,
      title: s.title,
      url: `https://news.hada.io/topic?id=${id}`,
      author: s.author,
      published: new Date(now - AGE_MIN[i] * 60_000).toISOString(),
      bullets: s.bullets,
      truncated: s.truncated,
    };
  });
}
