import { ScanNoteCard, ScanPlan } from './ScanWorkbenchChrome'

/**
 * 等待页「02 下一步 · 这一屏现在能做什么」那两张说明卡（稿 18 waiting-delivery / polling /
 * poll-failed / cancelling 四屏，外加稿里没画的 awaiting-ack）。
 *
 * **纯展示**：只按调用方给的状态挑文案，不碰任何请求、ref 或计时器 —— 判定全部留在
 * ScanProgressPage。拆出来是因为那一页已近 540 行（CLAUDE.md §8）。
 *
 * 文案照稿，但凡稿里的话和本机真实行为对不上的，按行为改写（逐条见各分支注释）。
 */
export type ScanProgressView = 'waiting-delivery' | 'polling' | 'poll-failed' | 'cancelling' | 'awaiting-ack'

export function ScanProgressNextCards({
  state,
  ackRetryable,
}: {
  state: ScanProgressView
  ackRetryable: boolean
}) {
  if (state === 'awaiting-ack') {
    /* 稿里没有这一屏：指路跟着主按钮走 —— 没拿到投递授权时右下角是「再确认一次」，
     * 写「立即检查」就是指向一颗不存在的按钮。 */
    return (
      <div className="sw-grid2 is-even">
        <ScanNoteCard title="这一屏现在会做什么" foot="再确认几次都不会多建一场，也不会延长有效期。">
          <ScanPlan items={[
            '本机正在向系统确认：这台机器可以收这一场的文件。',
            ackRetryable ? '上一次确认没成，点右下角「再确认一次」重来。' : '确认通常就是一两秒，不用你做任何事。',
            '不想扫了就点「取消这次扫描」，取消成不成由系统定。',
          ]} />
        </ScanNoteCard>
        <ScanNoteCard title="为什么先别按开始" foot="确认好了，这一屏会自己换成等文件。">
          <p>没确认之前，<b>系统还不肯把文件交给这一场</b> —— 扫出来的那张纸不会进你的记录，也不会被别人收走，只是白扫一次。</p>
        </ScanNoteCard>
      </div>
    )
  }

  if (state === 'polling') {
    /* 稿写「没扫成 / 超时 / 已取消 —— 各自的结果页」。本机收到「已取消」是回到选类型，
     * 不出结果页，所以拆开说。 */
    return (
      <div className="sw-grid2 is-even">
        <ScanNoteCard title="查完之后可能是哪几种" foot="只有系统明确说完成、并且把文件信息一起带回来，才会出能看文件的结果页。">
          <ScanPlan items={[
            '还在等 —— 回到等待页，接着等。',
            '已经好了 —— 出结果页，能看到这份文件。',
            '没扫成 / 超时 —— 各自的结果页；已取消 —— 回到选类型。',
            '这次没问到 —— 老实说不知道，不改判。',
          ]} />
        </ScanNoteCard>
        <ScanNoteCard title="这一刻你不用做什么" foot="正在等这次查询的结果。">
          <p>等这一次问答回来就行，通常一两秒。<b>不用再去面板上扫一遍</b> —— 重复扫会产生两份文件。</p>
          <p>这一次没有结论的话，本机会隔几秒自己再查一次。查询是一次纯读取：查多少次都不会重扫，也不会改变系统那边的任何东西。</p>
        </ScanNoteCard>
      </div>
    )
  }

  if (state === 'poll-failed') {
    /* 稿的落款是「再查几次都查不到，这里还是这句『不知道』」。本机连续查不动到上限会停下来、
     * 出「没拿到文件」的结果页，所以落款按真实行为写。 */
    return (
      <div className="sw-grid2 is-even">
        <ScanNoteCard title="接下来怎么办" foot="别重复扫，容易出两份；是否产生打印费用，以进入打印流程后系统的报价为准。">
          <ScanPlan items={[
            '本机会隔几秒自动再查一次，网络一恢复就能拿到结论。',
            '别回面板上重扫：这次任务在系统多半还活着。',
            '一直查不到就叫工作人员，他们能在这台机器上查出这次办理。',
          ]} />
        </ScanNoteCard>
        <ScanNoteCard title="查不到不等于扫失败" foot="连续很多次都查不到，本机会停下来，如实告诉你这次没拿到文件。">
          <p>查询失败说的是<b>本机没问到</b>，不是结果显示这次扫描不行。任务在系统该怎么走还怎么走。</p>
          <p>所以这一屏不改判，也不会替系统把它标成失败或完成。</p>
        </ScanNoteCard>
      </div>
    )
  }

  if (state === 'cancelling') {
    /* 稿里两处和本机行为对不上，按行为改写：
     *  · 「别刷新：临时凭证只在内存里」—— 本机把这次办理记在当前页面的存储里，刷新接得上；
     *    真正会丢掉这次办理的是点返回或底部导航（离开会一起撤掉）。
     *  · 「没生效 —— 回到等待页接着等」—— 取消没得到确认时本机也回到选类型，不回等待页。 */
    return (
      <div className="sw-grid2 is-even">
        <ScanNoteCard title="等结果的时候别做什么" foot="正在等取消结果。">
          <ScanPlan items={[
            '别再去面板上扫一遍。这次办理还没作废，重复扫会在打印机那边多出一份对不上的文件。',
            '也别点返回或底部导航：离开这一页会把这次办理一起撤掉，取消结果就看不到了。',
          ]} />
        </ScanNoteCard>
        <ScanNoteCard title="取消之后可能是哪几种" foot="只有「晚了一步」那一种能把文件带回这次办理，而且必须补查确认。">
          <ScanPlan items={[
            '取消成功 —— 这次办理作废，回到选类型。',
            '晚了一步 —— 文件刚好扫完了，本机再查一次，查到就直接出结果页。',
            '取消没得到确认 —— 本机同样回到选类型，页面不标成已取消。',
          ]} />
        </ScanNoteCard>
      </div>
    )
  }

  return (
    <div className="sw-grid2 is-even">
      <ScanNoteCard title="等太久怎么办" foot="别重复扫，容易出两份；是否产生打印费用，以进入打印流程后系统的报价为准。">
        <ScanPlan items={[
          '先确认面板上那一次扫描是不是真的完成了。面板没扫成，这里等多久也等不到文件。',
          '确认扫过了还是没回来，就请工作人员看一下打印机有没有扫完。',
        ]} />
      </ScanNoteCard>
      <ScanNoteCard title="这一屏现在会做什么" foot="自动检查是一次纯读取：不会重扫，也不会改变系统那边的任何东西。">
        <ScanPlan items={[
          '本机每隔几秒自动查一次，你什么都不用做。',
          '想马上知道就点「立即检查」，它只是插一次队，不改变结果。',
          '不想扫了就点「取消这次扫描」，取消成不成由系统定。',
        ]} />
      </ScanNoteCard>
    </div>
  )
}
