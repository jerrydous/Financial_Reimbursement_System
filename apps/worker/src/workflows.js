// 仅用于让 Temporal Worker 完成注册。审批等待从 P3 开始，不在这里实现流程引擎。
exports.workerPing = async function workerPing() {
  return 'ok';
};
