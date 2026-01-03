export let state = {
    currentId: 1,
    activeDivider: null,
    startX: 0,
    startY: 0,
    startSizeA: 0,
    startSizeB: 0
};

export function updateCurrentId(val) {
    state.currentId = val;
}
