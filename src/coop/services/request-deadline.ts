export async function withRequestDeadline<T>(work: Promise<T>, milliseconds = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Request timed out. Try again.")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
