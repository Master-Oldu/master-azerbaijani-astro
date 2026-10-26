import { formatDate } from '../dates';
import { accessSummary, emailText, esc, learnerHref, lessonText, pager, signInText } from '../markup';
import { createDashboardSource, PAGE_SIZE } from '../source';
import { fillSourceNote, paint, showFailure } from '../view';

export async function mountLearners(root: HTMLElement): Promise<void> {
  fillSourceNote();
  const source = createDashboardSource();
  let search = '';
  let page = 1;
  let timer = 0;
  let requestId = 0;

  async function draw(): Promise<void> {
    const current = ++requestId;
    try {
      const result = await source.listLearners({ search, page, pageSize: PAGE_SIZE });
      if (current !== requestId) return;
      page = result.page;
      const rows =
        result.learners.length === 0
          ? '<tr><td colspan="7" class="empty">No demonstration learners match that search.</td></tr>'
          : result.learners
              .map(
                (row) => `<tr>
                  <td><a href="${esc(learnerHref(row.id))}">${esc(row.name)}</a></td>
                  <td>${emailText(row.email)}</td>
                  <td>${esc(formatDate(row.signedUpAt))}</td>
                  <td>${esc(signInText(row.lastSignInAt))}</td>
                  <td class="num">${row.completedLessonCount}</td>
                  <td>${lessonText(row.lastCompletedLessonTitle, row.lastCompletedLessonAt)}</td>
                  <td>${accessSummary(row.access)}</td>
                </tr>`,
              )
              .join('');
      const html = `
        <section class="panel">
          <div class="panel-head">
            <h2>Learner directory</h2>
            <p class="lede">Premium access is the account's effective access now. A purchase still in review is noted separately and is not the access status. Last sign-in is account activity, not a lesson completion. Newest signups are listed first.</p>
          </div>
          <form class="filters" id="learner-search-form" role="search">
            <label for="learner-search">Search name or email
              <input id="learner-search" type="search" name="q" value="${esc(search)}" autocomplete="off" spellcheck="false" placeholder="Name or email" />
            </label>
          </form>
          <div class="table-wrap">
            <table class="directory">
              <caption>Dates are Pacific Time.</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Signup date</th>
                  <th>Last sign-in</th>
                  <th class="num">Completed lessons</th>
                  <th>Last completed lesson</th>
                  <th>Premium access</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${pager(result.page, result.pageSize, result.total, 'learners')}
        </section>
      `;
      await paint(root, html, bind);
    } catch (error) {
      console.error(error);
      if (current !== requestId) return;
      await showFailure(root);
    }
  }

  function bind(): void {
    const form = root.querySelector<HTMLFormElement>('#learner-search-form');
    const input = root.querySelector<HTMLInputElement>('#learner-search');
    input?.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        search = input.value;
        page = 1;
        void draw();
      }, 200);
    });
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      window.clearTimeout(timer);
      search = input?.value ?? '';
      page = 1;
      void draw();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        page = Number(button.dataset.page);
        void draw();
      });
    });
  }

  await draw();
}
