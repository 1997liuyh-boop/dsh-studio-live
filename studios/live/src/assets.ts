/** 形象只保存在本机 IndexedDB，不上传仓库；每次打开重新交给当前插件实例。 */
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dsh-studio-live', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('assets')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function avatarAsset(file?: Blob): Promise<Blob | undefined> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('assets', file ? 'readwrite' : 'readonly')
      const store = transaction.objectStore('assets'), request = file ? store.put(file, 'avatar') : store.get('avatar')
      let result: Blob | undefined
      request.onsuccess = () => { result = file ?? (request.result instanceof Blob ? request.result : undefined) }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('本机形象保存失败'))
    })
  } finally { db.close() }
}
