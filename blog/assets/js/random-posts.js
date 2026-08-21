const list = document.querySelector("[data-random-posts]");

if (list) {
  fetch(list.dataset.source)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load random posts: ${response.status}`);
      return response.json();
    })
    .then((posts) => {
      const pool = posts.slice(5);
      for (let index = pool.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
      }

      list.replaceChildren(
        ...pool.slice(0, 5).map((post) => {
          const item = document.createElement("li");
          const link = document.createElement("a");
          link.href = post.url;
          link.textContent = post.title;
          item.append(link);
          return item;
        })
      );
    })
    .catch(() => {
      // Keep the statically rendered links when the optional refresh fails.
    });
}
