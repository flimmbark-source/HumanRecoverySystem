// Entry point of the device build: open the database in the worker first, then start the normal client.
import '../client/styles.css';
import { ready } from './transport';

// The database lives in this origin's storage. Ask the browser not to clear it when the device is low on space.
void navigator.storage?.persist?.().catch(() => {});

ready.then(() => import('../client/main'), (e: Error) => {
  const card = document.createElement('div');
  card.className = 'authcard';
  const title = document.createElement('h1');
  title.textContent = 'Weave could not start';
  const reason = document.createElement('p');
  reason.className = 'alert bad';
  reason.textContent = `It could not open its database on this device. ${e.message}`;
  card.append(title, reason);
  document.querySelector('#root main')!.replaceChildren(card);
});
