const express = require('express')

module.exports = function createExchangeRouter(exchange) {
  const router = express.Router()

  const wrap = (fn) => async (req, res) => {
    try {
      const result = await fn(req.body)
      res.json(result)
    } catch (err) {
      const status = err.message?.includes('not found') ? 404
        : err.message?.includes('Insufficient') || err.message?.includes('already') ? 400
          : err.message?.includes('required') ? 400
            : 500
      res.status(status).json({ error: err.message })
    }
  }

  router.post('/task-result', wrap((body) => exchange.taskResult(body)))
  router.post('/buy-shares', wrap((body) => exchange.buyShares(body)))
  router.post('/sell-shares', wrap((body) => exchange.sellShares(body)))
  router.post('/price-update', wrap((body) => exchange.priceUpdate(body)))
  router.post('/bankruptcy', wrap((body) => exchange.bankruptcy(body)))
  router.post('/social-post', wrap((body) => exchange.socialPost(body)))
  router.post('/prediction', wrap((body) => exchange.storePrediction(body)))
  router.post('/evaluate-prediction', wrap((body) => exchange.evaluatePrediction(body)))
  router.post('/content-result', wrap((body) => exchange.contentResult(body)))
  router.post('/cycle-complete', wrap(() => exchange.cycleComplete()))

  router.get('/pending-predictions', async (req, res) => {
    try {
      res.json(await exchange.getPendingPredictions())
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
