import { computed, shallowRef } from 'vue'

/**
 * 积分设置的撤销 / 重做栈。
 * - 每次提交一次编辑前，把编辑前状态压入 undo 栈并清空 redo 栈
 * - 重新导入曲线时 reset() 回到初始状态
 *
 * 状态始终以 structuredClone 整体替换，使用 shallowRef 避免泛型解包问题。
 */
export function useHistory<T>(initial: T) {
  const present = shallowRef<T>(structuredClone(initial))
  const undoStack = shallowRef<T[]>([])
  const redoStack = shallowRef<T[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  /** 提交一次修改：before 为修改前的状态（通常为当前 present）。 */
  function commit(before: T, next: T) {
    undoStack.value = [...undoStack.value, structuredClone(before)]
    if (undoStack.value.length > 100) undoStack.value = undoStack.value.slice(-100)
    redoStack.value = []
    present.value = next
  }

  function undo() {
    const stack = undoStack.value
    const prev = stack[stack.length - 1]
    if (!prev) return
    undoStack.value = stack.slice(0, -1)
    redoStack.value = [...redoStack.value, structuredClone(present.value)]
    present.value = prev
  }

  function redo() {
    const stack = redoStack.value
    const next = stack[stack.length - 1]
    if (!next) return
    redoStack.value = stack.slice(0, -1)
    undoStack.value = [...undoStack.value, structuredClone(present.value)]
    present.value = next
  }

  /** 最近一次提交前的状态，用于显示“调整前后的差异”；无历史时为 null。 */
  const previous = computed<T | null>(() => {
    const stack = undoStack.value
    return stack.length > 0 ? stack[stack.length - 1] : null
  })

  function reset(state: T) {
    present.value = structuredClone(state)
    undoStack.value = []
    redoStack.value = []
  }

  return { present, canUndo, canRedo, commit, undo, redo, previous, reset }
}
