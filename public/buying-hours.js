const $ = id => document.getElementById(id);
const store = name => name === 'winmart' ? 'WinMart' : 'Bách Hóa Xanh';
const money = value => Number(value).toLocaleString('vi-VN') + ' đ';
const hourLabel = hour => `${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59`;
const ns = 'http://www.w3.org/2000/svg';
function svgElement(tag, attrs, text) {
  const element = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
}
export function renderBuyingHours(data) {
  if (!data) { $('hourSummary').textContent = 'Báo cáo chưa có phân tích theo giờ. Chạy phân tích để cập nhật.'; return; }
  $('hourSummary').textContent = `${data.summary.products} sản phẩm tại từng siêu thị · ${data.summary.recommended} sản phẩm đủ cơ sở gợi ý giờ mua · ${data.summary.provisional} kết quả tham khảo. Tất cả giờ dưới đây là giờ Việt Nam.`;
  const products = new Map(data.products.map(product => [product.id, product]));
  function detail() {
    const product = products.get($('hourProduct').value);
    if (!product) {
      $('hourAdvice').textContent = 'Không tìm thấy sản phẩm có dữ liệu trong 30 ngày gần nhất.';
      $('hourEvidence').textContent = '';
      $('hourChart').replaceChildren(); $('hourTable').replaceChildren();
      return;
    }
    const times = product.best_hours.map(hourLabel).join(', ');
    const advice = {
      insufficient: 'Chưa đủ dữ liệu để chọn giờ mua. Cần ít nhất hai khung giờ trên cùng ngày để so sánh.',
      no_hour_advantage: 'Chưa thấy khung giờ có lợi thế giá rõ rệt trong những giờ đã quan sát. Bạn có thể chọn giờ thuận tiện.',
      provisional: `Tham khảo: ${times} có giá tương đối thấp nhất trong những giờ đã quan sát. Chưa đủ ${data.minimum_common_days} ngày chung để khuyến nghị giờ mua.`,
      recommended: `Nên ưu tiên ${times} tại ${store(product.supermarket)} theo lịch sử giá đã quan sát.`
    };
    $('hourAdvice').textContent = advice[product.status];
    if (product.stale) $('hourAdvice').append(' Dữ liệu mới nhất đã quá 48 giờ; cần cập nhật giá trước khi quyết định.');
    if (product.current_price_is_good === true) $('hourAdvice').append(' Giá mới nhất hiện bằng hoặc thấp hơn giá trung vị của khung giờ tốt; có thể cân nhắc mua ngay.');
    if (product.current_price_is_good === false) $('hourAdvice').append(' Giá mới nhất còn cao hơn giá trung vị của khung giờ tốt; có thể theo dõi thêm.');
    $('hourEvidence').textContent = `${product.observed_days} ngày quan sát · ${product.observed_hours}/24 khung giờ · ${product.common_days} ngày chung dùng xếp hạng. Giá mới nhất ${money(product.latest_price)} lúc ${new Date(product.latest_collected_at).toLocaleString('vi-VN', {timeZone: data.timezone})}.`;
    if (product.typical_best_price !== null) $('hourEvidence').append(` Giá trung vị khung giờ tốt trên các ngày so sánh: ${money(product.typical_best_price)}; thấp hơn giờ có giá tương đối cao nhất khoảng ${product.relative_saving_percent}% trong lịch sử.`);
    const chart = svgElement('svg', {viewBox: '0 0 1000 340', role: 'img', 'aria-label': 'Giá trung vị của sản phẩm theo 24 giờ Việt Nam'});
    const hasComparison = product.hours.some(hour => hour.comparison_median_price != null);
    const plottedPrice = hour => hasComparison ? hour.comparison_median_price : hour.median_price;
    const max = Math.max(1, ...product.hours.map(hour => plottedPrice(hour) || 0));
    const byHour = new Map(product.hours.map(hour => [hour.hour, hour]));
    chart.append(svgElement('text', {x: 45, y: 18}, `Giá trung vị ${hasComparison ? 'trên các ngày chung' : 'toàn bộ ngày quan sát'} · tối đa ${money(max)}`));
    for (let hour = 0; hour < 24; hour++) {
      const x = 45 + hour * 38;
      const sample = byHour.get(hour);
      chart.append(svgElement('text', {x, y: 285, 'font-size': 12}, String(hour).padStart(2, '0')));
      if (!sample || plottedPrice(sample) == null) { chart.append(svgElement('text', {x: x + 8, y: 258, fill: '#64748b'}, '—')); continue; }
      const height = plottedPrice(sample) / max * 220;
      const bar = svgElement('rect', {x, y: 260 - height, width: 28, height, fill: product.best_hours.includes(hour) ? '#15803d' : '#94a3b8'});
      bar.append(svgElement('title', {}, `${hourLabel(hour)}: ${money(plottedPrice(sample))}, ${hasComparison ? product.common_days : sample.days} ngày`));
      chart.append(bar);
    }
    chart.append(svgElement('text', {x: 45, y: 320}, 'Xanh: giờ có giá tương đối thấp nhất · —: chưa có dữ liệu'));
    $('hourChart').replaceChildren(chart);
    const table = document.createElement('table');
    const heading = table.createTHead().insertRow();
    for (const label of ['Giờ Việt Nam', 'Trung vị toàn bộ ngày', 'Trung vị ngày chung', 'Thấp nhất', 'Cao nhất', 'Số ngày', 'Số quan sát']) {
      const cell = document.createElement('th'); cell.textContent = label; heading.append(cell);
    }
    const body = table.createTBody();
    for (const hour of product.hours) {
      const row = body.insertRow();
      for (const value of [hourLabel(hour.hour), money(hour.median_price), hour.comparison_median_price == null ? 'Chưa đủ' : money(hour.comparison_median_price), money(hour.min_price), money(hour.max_price), hour.days, hour.observations]) row.insertCell().textContent = value;
    }
    $('hourTable').replaceChildren(table);
  }
  function filter() {
    const previous = $('hourProduct').value;
    const query = $('hourSearch').value.toLocaleLowerCase('vi');
    const selectedStore = $('hourStore').value;
    const list = data.products.filter(product => product.name.toLocaleLowerCase('vi').includes(query) && (!selectedStore || product.supermarket === selectedStore));
    $('hourProduct').replaceChildren();
    for (const product of list) {
      const option = document.createElement('option'); option.value = product.id;
      option.textContent = `${product.name} · ${store(product.supermarket)}${product.size ? ' · ' + product.size : ''}`;
      $('hourProduct').append(option);
    }
    if (list.some(product => product.id === previous)) $('hourProduct').value = previous;
    detail();
  }
  $('hourSearch').oninput = filter; $('hourStore').onchange = filter; $('hourProduct').onchange = detail;
  filter();
}
