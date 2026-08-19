// pages/store-select/store-select.js
const api = require('../../utils/api')
const { guardPackageChain } = require('../../utils/package-feature')

Page({
  data: {
    statusBarHeight: 44,
    userLocation: null,
    selectedStore: null,
    stores: [],
    loading: true,
    error: null
  },

  onLoad(options) {
    if (guardPackageChain()) return
    const app = getApp()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 44
    })

    // 如果从材料包创建页面传来了数据，保存到临时存储
    if (options.from === 'package-create') {
      const packageData = wx.getStorageSync('temp_package_data')
      if (packageData) {
        console.log('接收到材料包数据:', packageData)
      }
    }

    // 加载真实服务点数据
    this._loadStores()
  },

  // 加载服务点列表
  _loadStores() {
    this.setData({ loading: true, error: null })
    
    api.getPublicTerminals()
      .then(list => {
        console.log('获取到服务点列表:', list)
        
        // 转换数据格式
        const stores = list.map(terminal => ({
          id: terminal.id,
          name: terminal.displayName || '服务点',
          address: terminal.locationLabel || '地址待补充',
          // 「计算中…」会一直停在那里：没有定位、也没有接地图距离服务，没有任何东西在算。
          distance: '距离待接入',
          distanceValue: 999999, // 默认排最后
          hours: '营业时间待补充',
          status: terminal.isOnline ? 'open' : 'closed',
          // 服务点电话后端尚未下发。原先写死 '010-00000000' 让页面看起来有联系方式，
          // 用户真拨过去只会打空号；接口补齐前留空，由 wxml 显示「电话待补充」。
          phone: '',
          facilities: ['打印', '扫描', '复印'] // 默认设施
        }))
        
        this.setData({ 
          stores,
          loading: false 
        })
        
        // 获取用户位置并计算距离
        this._getUserLocation()
      })
      .catch(err => {
        console.error('加载服务点失败:', err)
        this.setData({ 
          loading: false,
          error: err.message || '加载失败，请稍后重试'
        })
      })
  },

  // 获取用户位置
  _getUserLocation() {
    // 原先在这里塞了一个北京大学附近的固定坐标当作「用户位置」，任何人打开都被当成在北大。
    // 真实定位要走 wx.getLocation（需要 app.json 的 permission.scope.userLocation 与用户授权），
    // 距离计算还要接地图服务；这些都没有做，所以不假装有位置：不设 userLocation，
    // 列表上的距离保持 wxml 的「距离待计算」，不排序成看起来是按远近排的。
  },

  // 计算距离（实际使用时调用地图API）
  _calculateDistances() {
    // 实际使用时调用腾讯地图或高德地图API计算真实距离
    // 这里使用Mock数据
    const stores = this.data.stores.sort((a, b) => a.distanceValue - b.distanceValue)
    this.setData({ stores })
  },

  // 选择服务点
  selectStore(e) {
    const { id } = e.currentTarget.dataset
    const store = this.data.stores.find(s => s.id === id)
    
    this.setData({ selectedStore: id })
    
    // 保存选择的服务点到临时存储
    wx.setStorageSync('temp_selected_store', store)
    
    wx.showToast({
      title: '已选择服务点',
      icon: 'success',
      duration: 1500
    })
  },

  // 查看服务点详情
  viewStoreDetail(e) {
    const { id } = e.currentTarget.dataset
    wx.showToast({
      title: `查看服务点 ${id} 详情`,
      icon: 'none'
    })
    // 实际使用时跳转到服务点详情页或弹出详情弹窗
  },

  // 拨打电话
  callStore(e) {
    const { phone } = e.currentTarget.dataset
    // 电话为空时不要走 makePhoneCall —— 它失败后弹的是「拨打失败」，
    // 会被理解成网络或权限问题，而真实原因是后端根本没下发这个号码。
    if (!phone) {
      wx.showToast({ title: '该服务点暂未提供联系电话', icon: 'none' })
      return
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => {
        wx.showToast({
          title: '拨打失败',
          icon: 'none'
        })
      }
    })
  },

  // 在地图中查看
  viewInMap(e) {
    const { id } = e.currentTarget.dataset
    const store = this.data.stores.find(s => s.id === id)
    
    // store.lat / store.lng 从来没有被赋值过（上面的 map 里没有这两个字段，
    // 后端 getPublicTerminals 也不下发坐标），原实现等于用 undefined 调 openLocation。
    if (!store || typeof store.lat !== 'number' || typeof store.lng !== 'number') {
      wx.showToast({ title: '该服务点暂未提供地图坐标', icon: 'none' })
      return
    }
    wx.openLocation({
      latitude: store.lat,
      longitude: store.lng,
      name: store.name,
      address: store.address,
      scale: 15
    })
  },

  // 确认并继续
  confirmAndContinue() {
    const { selectedStore, stores } = this.data
    
    if (!selectedStore) {
      wx.showToast({
        title: '请先选择服务点',
        icon: 'none'
      })
      return
    }
    
    const store = stores.find(s => s.id === selectedStore)
    
    // 跳转到订单确认页面
    wx.navigateTo({
      url: '/pages/package-confirm/package-confirm',
      success: () => {
        // 传递数据通过storage（实际项目中可使用全局状态管理）
        wx.setStorageSync('temp_selected_store', store)
      }
    })
  },

  // 返回上一页
  goBack() {
    wx.navigateBack()
  }
})
