Vamos agora disponibilizar análize para a empresa Latan também.

url base: https://www.latamairlines.com/br/pt
análogo à azul, vamos utilizar a url para ancorar nossas pesquisas, fazendo pesquisas apenas de ida. caso uma análise requeira ida e volta, pesquisamos primeiro a ida e depois setamos os parâmetros da volta na ida. exatamente como na azul. a url de um caso teste foi:

https://www.latamairlines.com/br/pt/oferta-voos?origin=GRU&outbound=2026-05-30T00%3A00%3A00.000Z&destination=CNF&adt=1&chd=0&inf=0&trip=OW&cabin=Economy&redemption=false&sort=RECOMMENDED

onde:
GRU é a origem
2026-05-30 é a data de pesquisa
CNF é o destino.

Lembre-se que inicialmente a tela pode ter o botão de aceitar cookies:

<button data-testid="cookies-politics-button--button" id="cookies-politics-button" class="sc-sLsrZ grVRZb sc-dlWCHZ sc-iVDsrp gZceqW cneiaN"><span aria-hidden="false" class="sc-EgOXT BdTyF">Aceite todos os cookies</span></button>


na tela vamos procurar pelas linhas que representam os voos:

<div aria-expanded="false" aria-disabled="false" aria-controls="brand-offers-section-0" data-testid="wrapper-card-header-0" role="button" tabindex="0" class="cardFlightstyles__WrapperCardHeader-sc__sc-18f0ngu-1 kosbpF"><div data-testid="card-expander-0" class="cardFlightstyles__CardExpander-sc__sc-18f0ngu-2 hiLuEp"><span class="sc-iHGNWf keQWRK">Voo recomendado, mais econômico. Hora de saída 11:25, partida de São Paulo, aeroporto Guarulhos Intl., hora de chegada 12:35, em Belo Horizonte, aeroporto Confins. Voo direto, com duração total de 1 hora 10 minutos. Preço de um adulto a partir de 538,54 Reais brasileiros. Operado pela latam airlines brasil.</span><div aria-hidden="true" class="cardFlightstyles__FlightSummaryTagWrapper-sc__sc-18f0ngu-11 ljddwk"><span class="cardFlightstyles__FlightSummaryTagItem-sc__sc-18f0ngu-12 ftjTNb"><span>Recomendado</span></span><span class="cardFlightstyles__FlightSummaryTagItem-sc__sc-18f0ngu-12 gWxFxS"><span>Mais econômico</span></span></div><div id="FlightInfoComponent0" data-testid="flight-info-0" class="flightInfostyles__FlightInfoComponent-sc__sc-edlvrg-1 bsHYdu"><div aria-hidden="true" class="flightInfostyles__WrapperFlightInfo-sc__sc-edlvrg-2 wSEQq"><div class="flightInfostyles__ContainerFlightInfo-sc__sc-edlvrg-3 hfDboV flight-information" data-testid="flight-info-0-origin"><span font-weight="normal" class="sc-iGgWBj grbGAe latam-typography latam-typography--heading-04 sc-gsFSXq flightInfostyles__TextHourFlight-sc__sc-edlvrg-5 bMGeNQ jUaJWi">11:25</span><span class="sc-iGgWBj hpxKmm latam-typography latam-typography--paragraph-base sc-gsFSXq flightInfostyles__TextIATA-sc__sc-edlvrg-6 bMGeNQ dpuSIy">GRU</span></div><div class="flightInfostyles__ConnectorLine-sc__sc-edlvrg-8 jOpVeZ"></div><div id="ContainerFlightInfo0" role="presentation" class="flightInfostyles__ContainerFlightInfo-sc__sc-edlvrg-3 hfDboV flight-duration" data-testid="flight-info-0-duration"><span class="sc-iGgWBj hpxKmm latam-typography latam-typography--paragraph-medium sc-gsFSXq flightInfostyles__DurationText-sc__sc-edlvrg-12 bMGeNQ jLkwpM">Duração</span><span class="sc-iGgWBj hpxKmm latam-typography latam-typography--paragraph-base sc-gsFSXq flightInfostyles__Duration-sc__sc-edlvrg-13 bMGeNQ ctEEIB">1 h 10 min.</span></div><div class="flightInfostyles__ConnectorLine-sc__sc-edlvrg-8 jOpVeZ"></div><div class="flightInfostyles__ContainerFlightInfo-sc__sc-edlvrg-3 hfDboV flight-information" data-testid="flight-info-0-destination"><span font-weight="normal" class="sc-iGgWBj grbGAe latam-typography latam-typography--heading-04 sc-gsFSXq flightInfostyles__TextHourFlight-sc__sc-edlvrg-5 bMGeNQ jUaJWi">12:35<span font-weight="normal" color="#10004F" class="sc-iGgWBj fwUjdp latam-typography latam-typography--paragraph-medium sc-gsFSXq flightInfostyles__TextDaysDifference-sc__sc-edlvrg-7 bMGeNQ kXjCIB"></span></span><span font-weight="normal" color="#303030" class="sc-iGgWBj iaVwBV latam-typography latam-typography--paragraph-base sc-gsFSXq flightInfostyles__TextIATA-sc__sc-edlvrg-6 bMGeNQ dpuSIy">CNF</span></div></div><div aria-hidden="true" data-testid="flight-info-0-amount" class="flightInfostyles__AmountInfoContainer-sc__sc-edlvrg-0 hTPkxm"><span class="flightInfostyles__TextTitleAmount-sc__sc-edlvrg-10 eLxZNy">Por pessoa a partir de</span><div data-testid="display-currency-wrapper" class="displayCurrencystyle__DisplayCurrencyWrapper-sc__sc-hel5vp-0 bedHUU"><div data-testid="wrapper-currency-amount" class="displayCurrencystyle__WrapperCurrencyAmount-sc__sc-hel5vp-8 kwaaJT"><div class="displayCurrencystyle__TextAmount-sc__sc-hel5vp-3 bwyGPg displayAmount"><span class="sc-iHGNWf keQWRK">538,54 Reais brasileiros</span><span font-weight="normal" class="sc-iGgWBj grbGAe latam-typography latam-typography--heading-06 sc-gsFSXq displayCurrencystyle__CurrencyAmount-sc__sc-hel5vp-2 bMGeNQ koxMWe" aria-hidden="true">brl 538,54</span></div></div></div><span class="flightInfostyles__TaxesFeesIncludedText-sc__sc-edlvrg-11 fWrNjY">Inclui taxas e impostos</span></div></div></div><div data-testid="footer-card-0" class="cardFlightstyles__FooterCard-sc__sc-18f0ngu-14 jJjbqp"><div data-testid="ConnectorLineMobile" class="cardFlightstyles__ConnectorLineMobile-sc__sc-18f0ngu-22 eMFFlT"></div><div id="ContainerFooterCard0" class="cardFlightstyles__ContainerFooterCard-sc__sc-18f0ngu-16 gIUuKt"><a id="itinerary-modal-0-details-anchor" data-testid="itinerary-modal-0-details-anchor--link" tabindex="0" href="" class="sc-fqkvVR fLqvl sc-dcJsrY dwHOrx"><span>Direto</span></a><div data-testid="itinerary-dialog-wrapper" aria-hidden="true"></div><div class="cardFlightstyles__WrapperOperatorDesktop-sc__sc-18f0ngu-20 hgnGjL"><div data-testid="FlightOperators" class="flightOperatorsstyles__FlightOperatorContainer-sc__sc-ob3tfo-4 cUEcBb"><div data-testid="FlightOperatorDetail" class="flightOperatorsstyles__FlightOperatorDetail-sc__sc-ob3tfo-3 cAEEtc"><div data-testid="FlightOperatorText" class="flightOperatorsstyles__FlightOperatorText-sc__sc-ob3tfo-2 hKqSIi">Operado pela </div><div class="flightOperatorsstyles__Operator-sc__sc-ob3tfo-5 gNUkcb"><span data-testid="OperatorImage" class="flightOperatorsstyles__OperatorImage-sc__sc-ob3tfo-0 jcxxMK"><span style="box-sizing: border-box; display: inline-block; overflow: hidden; width: initial; height: initial; background: none; opacity: 1; border: 0px; margin: 0px; padding: 0px; position: relative; max-width: 100%;"><span style="box-sizing: border-box; display: block; width: initial; height: initial; background: none; opacity: 1; border: 0px; margin: 0px; padding: 0px; max-width: 100%;"><img alt="" aria-hidden="true" src="data:image/svg+xml,%3csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20version=%271.1%27%20width=%2716%27%20height=%2716%27/%3e" style="display: block; max-width: 100%; width: initial; height: initial; background: none; opacity: 1; border: 0px; margin: 0px; padding: 0px;"></span><img alt="LATAM Airlines Brasil" data-testid="image-LATAM Airlines Brasil" src="https://s.latamairlines.com/images/boreal/collections/v1/logos/latam/SymbolPositive.svg" decoding="async" data-nimg="intrinsic" style="position: absolute; inset: 0px; box-sizing: border-box; padding: 0px; border-width: medium; border-style: none; border-color: currentcolor; border-image: initial; margin: auto; display: block; width: 0px; height: 0px; min-width: 100%; max-width: 100%; min-height: 100%; max-height: 100%;"></span></span><div class="flightOperatorsstyles__OperatorName-sc__sc-ob3tfo-6 jpoCSu">LATAM Airlines Brasil</div></div></div></div></div></div><div aria-hidden="true" class="cardFlightstyles__AmountInfoContainer-sc__sc-18f0ngu-3 bEmoBq"><span class="cardFlightstyles__TextTitleAmount-sc__sc-18f0ngu-4 fnjQmF">Por pessoa a partir de</span><div class="xp_web_amount_info_container"><div data-testid="display-currency-wrapper" class="displayCurrencystyle__DisplayCurrencyWrapper-sc__sc-hel5vp-0 bedHUU"><div data-testid="wrapper-currency-amount" class="displayCurrencystyle__WrapperCurrencyAmount-sc__sc-hel5vp-8 kwaaJT"><div class="displayCurrencystyle__TextAmount-sc__sc-hel5vp-3 bwyGPg displayAmount"><span class="sc-iHGNWf keQWRK">538,54 Reais brasileiros</span><span font-weight="bold" class="sc-iGgWBj knlZmU latam-typography latam-typography--heading-06 sc-gsFSXq displayCurrencystyle__CurrencyAmount-sc__sc-hel5vp-2 bMGeNQ koxMWe" aria-hidden="true">brl 538,54</span></div></div></div></div></div><div class="cardFlightstyles__WrapperOperatorMobile-sc__sc-18f0ngu-21 cXiDGR"><div data-testid="FlightOperators" class="flightOperatorsstyles__FlightOperatorContainer-sc__sc-ob3tfo-4 cUEcBb"><div data-testid="FlightOperatorDetail" class="flightOperatorsstyles__FlightOperatorDetail-sc__sc-ob3tfo-3 cAEEtc"><div data-testid="FlightOperatorText" class="flightOperatorsstyles__FlightOperatorText-sc__sc-ob3tfo-2 hKqSIi">Operado pela </div><div class="flightOperatorsstyles__Operator-sc__sc-ob3tfo-5 gNUkcb"><span data-testid="OperatorImage" class="flightOperatorsstyles__OperatorImage-sc__sc-ob3tfo-0 jcxxMK"><span style="box-sizing: border-box; display: inline-block; overflow: hidden; width: initial; height: initial; background: none; opacity: 1; border: 0px; margin: 0px; padding: 0px; position: relative; max-width: 100%;"><span style="box-sizing: border-box; display: block; width: initial; height: initial; background: none; opacity: 1; border: 0px; margin: 0px; padding: 0px; max-width: 100%;"><img alt="" aria-hidden="true" src="data:image/svg+xml,%3csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20version=%271.1%27%20width=%2716%27%20height=%2716%27/%3e" style="display: block; max-width: 100%; width: initial; height: initial; background: none; opacity: 1; border: 0px; margin: 0px; padding: 0px;"></span><img alt="LATAM Airlines Brasil" data-testid="image-LATAM Airlines Brasil" src="https://s.latamairlines.com/images/boreal/collections/v1/logos/latam/SymbolPositive.svg" decoding="async" data-nimg="intrinsic" style="position: absolute; inset: 0px; box-sizing: border-box; padding: 0px; border-width: medium; border-style: none; border-color: currentcolor; border-image: initial; margin: auto; display: block; width: 0px; height: 0px; min-width: 100%; max-width: 100%; min-height: 100%; max-height: 100%;"></span></span><div class="flightOperatorsstyles__OperatorName-sc__sc-ob3tfo-6 jpoCSu">LATAM Airlines Brasil</div></div></div></div></div></div></div>


dentro dessas linhas temos:

<span font-weight="normal" class="sc-iGgWBj grbGAe latam-typography latam-typography--heading-04 sc-gsFSXq flightInfostyles__TextHourFlight-sc__sc-edlvrg-5 bMGeNQ jUaJWi">11:25</span>

que contem o horário de parida do voo.

<span class="sc-iGgWBj hpxKmm latam-typography latam-typography--paragraph-base sc-gsFSXq flightInfostyles__TextIATA-sc__sc-edlvrg-6 bMGeNQ dpuSIy">GRU</span>

contém a origem do voo

<div id="ContainerFlightInfo0" role="presentation" class="flightInfostyles__ContainerFlightInfo-sc__sc-edlvrg-3 hfDboV flight-duration" data-testid="flight-info-0-duration"><span class="sc-iGgWBj hpxKmm latam-typography latam-typography--paragraph-medium sc-gsFSXq flightInfostyles__DurationText-sc__sc-edlvrg-12 bMGeNQ jLkwpM">Duração</span><span class="sc-iGgWBj hpxKmm latam-typography latam-typography--paragraph-base sc-gsFSXq flightInfostyles__Duration-sc__sc-edlvrg-13 bMGeNQ ctEEIB">1 h 10 min.</span></div>

que contém as informações de duração do voo.

<span font-weight="normal" class="sc-iGgWBj grbGAe latam-typography latam-typography--heading-04 sc-gsFSXq flightInfostyles__TextHourFlight-sc__sc-edlvrg-5 bMGeNQ jUaJWi">12:35<span font-weight="normal" color="#10004F" class="sc-iGgWBj fwUjdp latam-typography latam-typography--paragraph-medium sc-gsFSXq flightInfostyles__TextDaysDifference-sc__sc-edlvrg-7 bMGeNQ kXjCIB"></span></span>

hora estimada da chegada no destino final

<span font-weight="normal" color="#303030" class="sc-iGgWBj iaVwBV latam-typography latam-typography--paragraph-base sc-gsFSXq flightInfostyles__TextIATA-sc__sc-edlvrg-6 bMGeNQ dpuSIy">CNF</span>

o destino final


<a id="itinerary-modal-0-details-anchor" data-testid="itinerary-modal-0-details-anchor--link" tabindex="0" href="" class="sc-fqkvVR fLqvl sc-dcJsrY dwHOrx"><span>Direto</span></a>

aqui temos as paradas, esse voo é direto mas um voo com escala seria:

<a id="itinerary-modal-8-details-anchor" data-testid="itinerary-modal-8-details-anchor--link" tabindex="0" href="" class="sc-fqkvVR fLqvl sc-dcJsrY dwHOrx"><span>1 parada</span></a>

e por fim:

<span font-weight="bold" class="sc-iGgWBj knlZmU latam-typography latam-typography--heading-06 sc-gsFSXq displayCurrencystyle__CurrencyAmount-sc__sc-hel5vp-2 bMGeNQ koxMWe" aria-hidden="true">brl 3.833,64</span>

aqui temos as informação do valor da passagem, em reais.


para pesquisa em pontos, vamos te ruma dificuldade a mais, precisamos fazer o login.

o link muda para: https://www.latamairlines.com/br/pt/oferta-voos?origin=GRU&outbound=2026-05-30T12%3A00%3A00.000Z&destination=CNF&inbound=null&adt=1&chd=0&inf=0&trip=OW&cabin=Economy&redemption=true&sort=RECOMMENDED


vai aparecer uma tela de login:

onde o cpf deve ser inserido no campo:

<input aria-invalid="true" autocomplete="off" id="form-input--alias" name="alias" placeholder="Email, CPF ou Número de cliente" type="text" data-testid="form-input--alias-textfield-input" class="MuiInputBase-input MuiOutlinedInput-input MuiInputBase-inputAdornedEnd MuiOutlinedInput-inputAdornedEnd" value="" aria-describedby="form-input--alias-helper-text">

apertar em continuar: 

<button class="MuiButtonBase-root MuiButton-root MuiButton-contained xp-Button-null MuiButton-containedPrimary MuiButton-containedSizeLarge MuiButton-sizeLarge MuiButton-disableElevation MuiButton-fullWidth" tabindex="0" type="submit" id="primary-button" data-testid="primary-button-button"><span class="MuiButton-label">Continuar</span></button>

depois a senha em:

<input aria-invalid="true" autocomplete="off" id="form-input--password" name="password" placeholder="Senha" type="password" data-testid="form-input--password-textfield-input" class="MuiInputBase-input MuiOutlinedInput-input MuiInputBase-inputAdornedEnd MuiOutlinedInput-inputAdornedEnd" value="" aria-describedby="form-input--password-helper-text">

apertar em fazer o login

<button class="MuiButtonBase-root MuiButton-root MuiButton-contained xp-Button-null MuiButton-containedPrimary MuiButton-containedSizeLarge MuiButton-sizeLarge MuiButton-disableElevation MuiButton-fullWidth" tabindex="0" type="submit" id="primary-button" data-testid="primary-button-button"><span class="MuiButton-label">Fazer login</span></button>


Vamos visualizar uma lista bem parecida de voos, o que muda é que o card de preço indicarar o valor em milhas:

<div aria-hidden="true" class="cardFlightstyles__AmountInfoContainer-sc__sc-18f0ngu-3 bEmoBq"><span class="cardFlightstyles__TextTitleAmount-sc__sc-18f0ngu-4 fnjQmF">Por pessoa a partir de</span><div class="xp_web_amount_info_container"><div data-testid="display-currency-wrapper" class="displayCurrencystyle__DisplayCurrencyWrapper-sc__sc-hel5vp-0 hXoWUX"><div data-testid="loyalty-points-wrapper" class="displayCurrencystyle__WrapperLoyaltyPoints-sc__sc-hel5vp-9 eOPqEm"><div class="displayCurrencystyle__TextAmount-sc__sc-hel5vp-3 bwyGPg displayAmount"><span font-weight="bold" class="sc-iGgWBj knlZmU latam-typography latam-typography--heading-06 sc-gsFSXq displayCurrencystyle__CurrencyAmount-sc__sc-hel5vp-2 bMGeNQ koxMWe">15.778 milhas</span></div><span class="displayCurrencystyle__Description-sc__sc-hel5vp-5 keGiPa">+ BRL&nbsp;33,64</span></div></div></div></div>


Todos os cards apresentam o valor em milhas e um valor pequeno em Reais, vamos considerar apenas os pontos por enquanto, não oferecendo uma opção híbrida pra latam pois o reço em Reais parece ser apenas uma taxa fixa.

Nota-se que agora precisamos de um cadástro para acessar os pontos. vamos esperar o cpf e a senha via secret env e caso não tenhamos esses valores ou incorra em fracasso a obtensão do valor em pontos, vamos seguir com apenas o valor em reais mesmo.

Um ponto de antenção. adicionei na raiz do projeto o schema.ts que a flight.API utiliza para validar a request resultado vinda desse projeto. precisamos padronizar nossa sinformações de acordo com os parâmetros definidos por ela.


um último detalhe:

pode aparecer logo após acessarmos o link para compra da passagem utilizando apenas dinheiro, um modal para selecionar a moeda:

<div aria-hidden="false" data-testid="country-suggestion--dialog" id="country-suggestion" role="dialog" class="sc-bdOgaJ ghsFAT sc-czkgLR gNnFzr" aria-describedby="country-suggestion--dialog__title"><div id="country-suggestion--dialog__body" data-testid="country-suggestion--dialog__body" class="sc-empnci iInVdz"><h3 class="sc-iGgWBj hpxKmm latam-typography latam-typography--heading-03 sc-gsFSXq sc-fThUAz bMGeNQ vwsfB" data-testid="country-suggestion--dialog__title" id="country-suggestion--dialog__title"><span>Você está no nosso site <strong>Brasil</strong></span></h3><div class="sc-fulCBj kVQJqV"><button data-testid="country-suggestion--dialog-close-button" id="country-suggestion--dialog__close-button" aria-label="Fechar" class="sc-sLsrZ gOnfed sc-dlWCHZ sc-ERObt gZceqW fQJesW sc-dNsVcS bFaeAz sc-kMribo kcHLYw" type="button"><span aria-hidden="false" class="sc-EgOXT BdTyF"><i aria-hidden="true" class="sc-eqUAAy kKXDSu"><svg xmlns="http://www.w3.org/2000/svg" fill="none" focusable="false" viewBox="0 0 32 32"><path d="M24.4999 27.2075L15.9999 18.8115L7.49992 27.2075L4.79199 24.5L13.188 15.9996L4.79199 7.49998L7.49992 4.99998L15.9801 13.2075L24.4999 4.81146L27.188 7.49998L18.792 15.9996L27.188 24.5L24.4999 27.2075Z" fill="currentColor"></path></svg></i></span></button></div><div data-testid="country-suggestion--dialog__content" class="sc-SrznA iqDVtF"><p class="sc-iGgWBj hpxKmm latam-typography latam-typography--paragraph-base sc-gsFSXq bMGeNQ" data-testid="country-suggestion--country-suggestion__description">Troque para a LATAM Reino Unido e confira os preços na moeda definida para esse país. Se decidir continuar, vai ver os preços para Brasil.</p><div data-testid="country-suggestion--country-suggestion__actions" class="sc-zlUcK fWuzcb"><button data-testid="country-suggestion-accept-change--button" id="country-suggestion-accept-change" class="sc-sLsrZ eRDHVS sc-dlWCHZ gZceqW"><span aria-hidden="false" class="sc-EgOXT BdTyF">Trocar para a LATAM Reino Unido</span></button><button data-testid="country-suggestion-reject-change--button" id="country-suggestion-reject-change" class="sc-sLsrZ jQPxzI sc-dlWCHZ gZceqW"><span aria-hidden="false" class="sc-EgOXT BdTyF">Continuar na LATAM Brasil</span></button></div></div></div></div>

nesse caso vamos clicar em:

<button data-testid="country-suggestion-reject-change--button" id="country-suggestion-reject-change" class="sc-sLsrZ jQPxzI sc-dlWCHZ gZceqW"><span aria-hidden="false" class="sc-EgOXT BdTyF">Continuar na LATAM Brasil</span></button>

esse modal vai aparecer apenas quando eu rodar o script fora do Brasil, vai acontecer apenas para depuração então caso o modal nã oseja exibido, seguimos com a análise se essa parte.